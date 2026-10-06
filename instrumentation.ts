export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { startRecoveryWorker } = await import("./lib/recovery");
    startRecoveryWorker();
  }
}
