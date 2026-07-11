#import <ApplicationServices/ApplicationServices.h>
#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <sys/socket.h>
#import <sys/stat.h>
#import <sys/un.h>
#import <unistd.h>

static const uint8_t AgentFailure = 5;
static const uint8_t AgentRequestIdentities = 11;
static const uint8_t AgentIdentitiesAnswer = 12;
static const uint8_t AgentSignRequest = 13;
static const uint8_t AgentSignResponse = 14;
static NSString *const KeyAlgorithm = @"ecdsa-sha2-nistp256";
static NSString *const CurveName = @"nistp256";
static NSString *const KeyTag = @"com.posthog.array.signing-key";
static NSString *const UnavailableMessage = @"The Secure Enclave is not available right now. Please continue working; signing will become available when the user returns and unlocks the device.";

static void AppendUInt32(NSMutableData *data, uint32_t value) {
    uint32_t bigEndian = CFSwapInt32HostToBig(value);
    [data appendBytes:&bigEndian length:sizeof(bigEndian)];
}

static void AppendDataString(NSMutableData *data, NSData *value) {
    AppendUInt32(data, (uint32_t)value.length);
    [data appendData:value];
}

static void AppendString(NSMutableData *data, NSString *value) {
    AppendDataString(data, [value dataUsingEncoding:NSUTF8StringEncoding]);
}

static NSData *Frame(NSData *payload) {
    NSMutableData *result = [NSMutableData data];
    AppendUInt32(result, (uint32_t)payload.length);
    [result appendData:payload];
    return result;
}

static NSData *ReadExactly(int fd, NSUInteger count) {
    NSMutableData *data = [NSMutableData dataWithLength:count];
    NSUInteger offset = 0;
    while (offset < count) {
        ssize_t amount = read(fd, (uint8_t *)data.mutableBytes + offset, count - offset);
        if (amount == 0) return offset == 0 ? nil : nil;
        if (amount < 0) return nil;
        offset += (NSUInteger)amount;
    }
    return data;
}

static BOOL WriteAll(int fd, NSData *data) {
    NSUInteger offset = 0;
    while (offset < data.length) {
        ssize_t amount = write(fd, (const uint8_t *)data.bytes + offset, data.length - offset);
        if (amount <= 0) return NO;
        offset += (NSUInteger)amount;
    }
    return YES;
}

static NSData *ReadFrame(int fd) {
    NSData *header = ReadExactly(fd, 4);
    if (!header) return nil;
    uint32_t length = CFSwapInt32BigToHost(*(const uint32_t *)header.bytes);
    if (length > 16 * 1024 * 1024) return nil;
    return ReadExactly(fd, length);
}

static NSData *ReadLine(int fd) {
    NSMutableData *data = [NSMutableData data];
    uint8_t byte = 0;
    while (read(fd, &byte, 1) == 1) {
        if (byte == '\n') return data;
        [data appendBytes:&byte length:1];
        if (data.length > 65536) return nil;
    }
    return nil;
}

static BOOL SessionIsUnlocked(void) {
    NSDictionary *session = CFBridgingRelease(CGSessionCopyCurrentDictionary());
    return [session[(NSString *)kCGSessionOnConsoleKey] boolValue] &&
        [session[(NSString *)kCGSessionLoginDoneKey] boolValue] &&
        ![session[@"CGSSessionScreenIsLocked"] boolValue];
}

static NSData *ReadSSHString(NSData *data, NSUInteger *offset) {
    if (*offset + 4 > data.length) return nil;
    uint32_t length = CFSwapInt32BigToHost(*(const uint32_t *)((const uint8_t *)data.bytes + *offset));
    *offset += 4;
    if (*offset + length > data.length) return nil;
    NSData *result = [data subdataWithRange:NSMakeRange(*offset, length)];
    *offset += length;
    return result;
}

static NSData *Mpint(NSData *raw) {
    const uint8_t *bytes = raw.bytes;
    NSUInteger offset = 0;
    while (offset < raw.length && bytes[offset] == 0) offset++;
    if (offset == raw.length) return [NSData data];
    NSMutableData *result = [NSMutableData data];
    if (bytes[offset] & 0x80) {
        uint8_t zero = 0;
        [result appendBytes:&zero length:1];
    }
    [result appendBytes:bytes + offset length:raw.length - offset];
    return result;
}

static NSArray<NSData *> *ParseDERSignature(NSData *signature) {
    const uint8_t *bytes = signature.bytes;
    NSUInteger offset = 0;
    if (signature.length < 8 || bytes[offset++] != 0x30) return nil;
    NSUInteger sequenceLength = bytes[offset++];
    if (sequenceLength & 0x80) {
        NSUInteger count = sequenceLength & 0x7f;
        if (count == 0 || count > 2 || offset + count > signature.length) return nil;
        sequenceLength = 0;
        for (NSUInteger index = 0; index < count; index++) sequenceLength = (sequenceLength << 8) | bytes[offset++];
    }
    if (offset + sequenceLength > signature.length || bytes[offset++] != 0x02) return nil;
    NSUInteger rLength = bytes[offset++];
    if (offset + rLength + 2 > signature.length) return nil;
    NSData *r = [signature subdataWithRange:NSMakeRange(offset, rLength)];
    offset += rLength;
    if (bytes[offset++] != 0x02) return nil;
    NSUInteger sLength = bytes[offset++];
    if (offset + sLength > signature.length) return nil;
    NSData *s = [signature subdataWithRange:NSMakeRange(offset, sLength)];
    return @[Mpint(r), Mpint(s)];
}

@interface SecureEnclaveKey : NSObject
@property(nonatomic) SecKeyRef privateKey;
@property(nonatomic, readonly) NSData *publicBlob;
- (instancetype)initWithError:(NSError **)error;
- (NSData *)sign:(NSData *)data error:(NSError **)error;
@end

@implementation SecureEnclaveKey
- (instancetype)initWithError:(NSError **)error {
    self = [super init];
    if (!self) return nil;
    NSData *tag = [KeyTag dataUsingEncoding:NSUTF8StringEncoding];
    NSDictionary *query = @{
        (__bridge id)kSecClass: (__bridge id)kSecClassKey,
        (__bridge id)kSecAttrApplicationTag: tag,
        (__bridge id)kSecAttrKeyType: (__bridge id)kSecAttrKeyTypeECSECPrimeRandom,
        (__bridge id)kSecReturnRef: @YES,
    };
    CFTypeRef item = nil;
    OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &item);
    if (status == errSecSuccess) {
        _privateKey = (SecKeyRef)item;
    } else if (status == errSecItemNotFound) {
        NSDictionary *attributes = @{
            (__bridge id)kSecAttrKeyType: (__bridge id)kSecAttrKeyTypeECSECPrimeRandom,
            (__bridge id)kSecAttrKeySizeInBits: @256,
            (__bridge id)kSecAttrTokenID: (__bridge id)kSecAttrTokenIDSecureEnclave,
            (__bridge id)kSecPrivateKeyAttrs: @{
                (__bridge id)kSecAttrIsPermanent: @YES,
                (__bridge id)kSecAttrApplicationTag: tag,
                (__bridge id)kSecAttrAccessible: (__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            },
        };
        CFErrorRef creationError = nil;
        _privateKey = SecKeyCreateRandomKey((__bridge CFDictionaryRef)attributes, &creationError);
        if (!_privateKey) {
            if (error) *error = CFBridgingRelease(creationError);
            return nil;
        }
    } else {
        if (error) *error = [NSError errorWithDomain:NSOSStatusErrorDomain code:status userInfo:nil];
        return nil;
    }
    SecKeyRef publicKey = SecKeyCopyPublicKey(_privateKey);
    CFErrorRef publicError = nil;
    NSData *representation = CFBridgingRelease(SecKeyCopyExternalRepresentation(publicKey, &publicError));
    CFRelease(publicKey);
    if (!representation) {
        if (error) *error = CFBridgingRelease(publicError);
        return nil;
    }
    NSMutableData *blob = [NSMutableData data];
    AppendString(blob, KeyAlgorithm);
    AppendString(blob, CurveName);
    AppendDataString(blob, representation);
    _publicBlob = blob;
    return self;
}

- (void)dealloc {
    if (_privateKey) CFRelease(_privateKey);
}

- (NSData *)sign:(NSData *)data error:(NSError **)error {
    CFErrorRef signingError = nil;
    NSData *der = CFBridgingRelease(SecKeyCreateSignature(
        _privateKey,
        kSecKeyAlgorithmECDSASignatureMessageX962SHA256,
        (__bridge CFDataRef)data,
        &signingError
    ));
    if (!der) {
        NSError *underlying = CFBridgingRelease(signingError);
        if (error) *error = [NSError errorWithDomain:@"com.posthog.code.signing" code:1 userInfo:@{
            NSLocalizedDescriptionKey: [NSString stringWithFormat:@"%@ macOS reported: %@", UnavailableMessage, underlying.localizedDescription ?: @"unknown error"]
        }];
        return nil;
    }
    NSArray<NSData *> *parts = ParseDERSignature(der);
    if (!parts) return nil;
    NSMutableData *inner = [NSMutableData data];
    AppendDataString(inner, parts[0]);
    AppendDataString(inner, parts[1]);
    NSMutableData *outer = [NSMutableData data];
    AppendString(outer, KeyAlgorithm);
    AppendDataString(outer, inner);
    return outer;
}
@end

@interface Broker : NSObject
@property(nonatomic, readonly) NSString *controlSocketPath;
@property(nonatomic, readonly) NSString *agentSocketPath;
@property(nonatomic, readonly) SecureEnclaveKey *key;
@property(nonatomic, readonly) NSMutableSet<NSString *> *leases;
@property(nonatomic, readonly) dispatch_queue_t stateQueue;
@property(nonatomic) BOOL signingAuthorized;
@property(nonatomic) dispatch_source_t parentMonitor;
@property(nonatomic, readonly) pid_t parentPID;
@property(nonatomic, readonly) NSString *controlToken;
- (instancetype)initWithRuntimeDirectory:(NSString *)directory parentPID:(pid_t)parentPID controlToken:(NSString *)controlToken error:(NSError **)error;
- (void)run;
@end

@implementation Broker
- (instancetype)initWithRuntimeDirectory:(NSString *)directory parentPID:(pid_t)parentPID controlToken:(NSString *)controlToken error:(NSError **)error {
    self = [super init];
    if (!self) return nil;
    [[NSFileManager defaultManager] createDirectoryAtPath:directory withIntermediateDirectories:YES attributes:@{NSFilePosixPermissions: @0700} error:error];
    if (*error) return nil;
    _controlSocketPath = [directory stringByAppendingPathComponent:@"control.sock"];
    _agentSocketPath = [directory stringByAppendingPathComponent:@"agent.sock"];
    unlink(_controlSocketPath.fileSystemRepresentation);
    unlink(_agentSocketPath.fileSystemRepresentation);
    _key = [[SecureEnclaveKey alloc] initWithError:error];
    if (!_key) return nil;
    _leases = [NSMutableSet set];
    _stateQueue = dispatch_queue_create("com.posthog.code.signing-agent", DISPATCH_QUEUE_SERIAL);
    _parentPID = parentPID;
    _controlToken = [controlToken copy];
    return self;
}

- (int)listenAtPath:(NSString *)path {
    int fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (fd < 0) return -1;
    struct sockaddr_un address = {0};
    address.sun_family = AF_UNIX;
    const char *fileSystemPath = path.fileSystemRepresentation;
    if (strlen(fileSystemPath) >= sizeof(address.sun_path)) { close(fd); return -1; }
    strcpy(address.sun_path, fileSystemPath);
    socklen_t length = (socklen_t)(offsetof(struct sockaddr_un, sun_path) + strlen(fileSystemPath) + 1);
    if (bind(fd, (struct sockaddr *)&address, length) != 0 || listen(fd, 32) != 0) { close(fd); return -1; }
    chmod(fileSystemPath, 0600);
    return fd;
}

- (void)run {
    int control = [self listenAtPath:_controlSocketPath];
    int agent = [self listenAtPath:_agentSocketPath];
    if (control < 0 || agent < 0) exit(1);
    signal(SIGPIPE, SIG_IGN);
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{ [self acceptLoop:control control:YES]; });
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{ [self acceptLoop:agent control:NO]; });
    _parentMonitor = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());
    dispatch_source_set_timer(_parentMonitor, dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC), NSEC_PER_SEC, NSEC_PER_SEC / 10);
    dispatch_source_set_event_handler(_parentMonitor, ^{
        if (kill(self->_parentPID, 0) != 0) exit(0);
    });
    dispatch_resume(_parentMonitor);
    dispatch_main();
}

- (void)acceptLoop:(int)listener control:(BOOL)isControl {
    while (YES) {
        int client = accept(listener, NULL, NULL);
        if (client < 0) continue;
        dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
            if (isControl) [self handleControl:client]; else [self handleAgent:client];
            close(client);
        });
    }
}

- (void)handleControl:(int)fd {
    NSData *line = ReadLine(fd);
    NSDictionary *request = line ? [NSJSONSerialization JSONObjectWithData:line options:0 error:nil] : nil;
    NSString *action = request[@"action"];
    NSMutableDictionary *response = [@{@"ok": @YES} mutableCopy];
    __block NSString *errorMessage = nil;
    dispatch_sync(_stateQueue, ^{
        if (![request[@"token"] isEqualToString:_controlToken]) {
            errorMessage = @"The signing broker rejected an unauthorized control request.";
            return;
        }
        NSString *agentId = request[@"agentId"];
        if ([action isEqualToString:@"status"]) return;
        if ([action isEqualToString:@"acquire"] && agentId) {
            if (_leases.count == 0) _signingAuthorized = SessionIsUnlocked();
            [_leases addObject:agentId];
            response[@"socketPath"] = _agentSocketPath;
            response[@"publicKey"] = [NSString stringWithFormat:@"%@ %@", KeyAlgorithm, [_key.publicBlob base64EncodedStringWithOptions:0]];
            return;
        }
        if ([action isEqualToString:@"release"] && agentId) {
            [_leases removeObject:agentId];
            if (_leases.count == 0) _signingAuthorized = NO;
            return;
        }
        errorMessage = @"The signing broker received an invalid control request.";
    });
    if (errorMessage) response = [@{@"ok": @NO, @"error": errorMessage} mutableCopy];
    NSMutableData *output = [[NSJSONSerialization dataWithJSONObject:response options:0 error:nil] mutableCopy];
    uint8_t newline = '\n';
    [output appendBytes:&newline length:1];
    WriteAll(fd, output);
}

- (void)handleAgent:(int)fd {
    while (YES) {
        NSData *message = ReadFrame(fd);
        if (!message) return;
        const uint8_t *bytes = message.bytes;
        if (message.length == 0) return;
        uint8_t type = bytes[0];
        NSMutableData *response = [NSMutableData data];
        if (type == AgentRequestIdentities) {
            uint8_t answer = AgentIdentitiesAnswer;
            [response appendBytes:&answer length:1];
            AppendUInt32(response, 1);
            AppendDataString(response, _key.publicBlob);
            AppendString(response, @"PostHog Code Secure Enclave");
        } else if (type == AgentSignRequest) {
            NSUInteger offset = 1;
            NSData *requestedKey = ReadSSHString(message, &offset);
            NSData *data = ReadSSHString(message, &offset);
            __block BOOL allowed = NO;
            dispatch_sync(_stateQueue, ^{
                if (_leases.count > 0 && !_signingAuthorized && SessionIsUnlocked()) {
                    _signingAuthorized = YES;
                }
                allowed = _leases.count > 0 && _signingAuthorized;
            });
            if (!allowed || ![requestedKey isEqualToData:_key.publicBlob] || !data) {
                [response appendBytes:&AgentFailure length:1];
            } else {
                NSError *error = nil;
                NSData *signature = [_key sign:data error:&error];
                if (!signature) {
                    fprintf(stderr, "%s\n", (error.localizedDescription ?: UnavailableMessage).UTF8String);
                    [response appendBytes:&AgentFailure length:1];
                } else {
                    uint8_t answer = AgentSignResponse;
                    [response appendBytes:&answer length:1];
                    AppendDataString(response, signature);
                }
            }
        } else {
            [response appendBytes:&AgentFailure length:1];
        }
        if (!WriteAll(fd, Frame(response))) return;
    }
}
@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSString *executableName = @(argv[0]).lastPathComponent;
        BOOL isSSHKeygenWrapper = [executableName isEqualToString:@"posthog-code-ssh-keygen"];
        if (isSSHKeygenWrapper || (argc >= 2 && strcmp(argv[1], "ssh-keygen") == 0)) {
            int argumentOffset = isSSHKeygenWrapper ? 1 : 2;
            pid_t child = fork();
            if (child == 0) {
                char **arguments = calloc((size_t)argc + 1, sizeof(char *));
                arguments[0] = "/usr/bin/ssh-keygen";
                for (int index = argumentOffset; index < argc; index++) arguments[index - argumentOffset + 1] = (char *)argv[index];
                execv(arguments[0], arguments);
                _exit(127);
            }
            int status = 0;
            waitpid(child, &status, 0);
            if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) {
                fprintf(stderr, "\n%s\n", UnavailableMessage.UTF8String);
                return WIFEXITED(status) ? WEXITSTATUS(status) : 1;
            }
            return 0;
        }
        if (argc != 5 || strcmp(argv[1], "serve") != 0) {
            fprintf(stderr, "usage: posthog-code-signing-agent serve <runtime-directory> <parent-pid> <control-token> | ssh-keygen <arguments...>\n");
            return 64;
        }
        NSError *error = nil;
        Broker *broker = [[Broker alloc]
            initWithRuntimeDirectory:@(argv[2])
            parentPID:(pid_t)strtol(argv[3], NULL, 10)
            controlToken:@(argv[4])
            error:&error
        ];
        if (!broker) {
            fprintf(stderr, "%s\n", (error.localizedDescription ?: @"Could not start signing broker.").UTF8String);
            return 1;
        }
        [broker run];
    }
}
