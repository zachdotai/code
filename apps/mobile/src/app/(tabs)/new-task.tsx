import { router, useFocusEffect } from "expo-router";
import { useCallback } from "react";

export default function NewTaskTrampoline() {
  useFocusEffect(
    useCallback(() => {
      router.replace("/tasks");
      router.push("/task");
    }, []),
  );
  return null;
}
