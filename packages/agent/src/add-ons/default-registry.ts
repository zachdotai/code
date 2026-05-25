import { AddOnRegistry } from "./registry";
import { rtkAddOn } from "./rtk";

/**
 * Process-wide default registry. Built-in add-ons are registered here so
 * adapters can resolve them without ceremony.
 */
export const defaultAddOnRegistry = new AddOnRegistry();
defaultAddOnRegistry.register(rtkAddOn);
