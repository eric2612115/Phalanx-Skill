/**
 * Progress / typing helpers for long-running Telegram steps (transport injected by caller).
 */

export type TelegramTextSender = (text: string) => Promise<void>;
export type TelegramTypingSender = () => Promise<void>;

export async function sendProgress(stage: string): Promise<string> {
  return `Processing: ${stage}`;
}

export async function notifyProgress(stage: string, sendText: TelegramTextSender): Promise<void> {
  const line = await sendProgress(stage);
  await sendText(line);
}

/**
 * Runs `work` after optional typing indicator and a progress line. Typing is best-effort (failures ignored).
 */
export async function withProgressAndTyping(
  stage: string,
  sendText: TelegramTextSender,
  sendTyping: TelegramTypingSender | undefined,
  work: () => Promise<void>,
): Promise<void> {
  if (sendTyping) {
    try {
      await sendTyping();
    } catch {
      // typing is optional UX sugar
    }
  }
  await notifyProgress(stage, sendText);
  await work();
}
