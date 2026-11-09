import { useState } from "react";

/** Shared busy flag and the error and notice messages shown above the track list. */
export function useStatus() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  /** Runs a task while busy and shows `failure` as the error if it throws. */
  async function run(task: () => Promise<void>, failure: string | ((cause: unknown) => string)) {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (cause) {
      setError(typeof failure === "string" ? failure : failure(cause));
    } finally {
      setBusy(false);
    }
  }

  function clear() {
    setError("");
    setNotice("");
  }

  return { busy, error, notice, setError, setNotice, clear, run };
}

export type Status = ReturnType<typeof useStatus>;
