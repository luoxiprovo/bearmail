import { CAPABILITIES } from "../types";
import { JmapClient, JmapError } from "./client";

interface SetResult {
  updated?: Record<string, null>;
  notUpdated?: Record<string, Record<string, unknown>>;
}

export const ACCOUNT_PASSWORD_ID = "singleton";
export const PASSWORD_MIN_LENGTH = 8;

export function validateNewPassword(currentPassword: string, newPassword: string, confirmPassword: string): void {
  if (!currentPassword.trim() || !newPassword || !confirmPassword) {
    throw new JmapError("Enter your current password and a new password twice.", "invalidProperties");
  }
  if (newPassword !== confirmPassword) {
    throw new JmapError("The new passwords do not match.", "invalidProperties");
  }
  if (newPassword === currentPassword) {
    throw new JmapError("Choose a new password that is different from the current one.", "invalidProperties");
  }
  if (newPassword.length < PASSWORD_MIN_LENGTH) {
    throw new JmapError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`, "invalidProperties");
  }
}

export async function changeAccountPassword(client: JmapClient, currentPassword: string, newPassword: string): Promise<void> {
  validateNewPassword(currentPassword, newPassword, newPassword);
  const result = await client.call<SetResult>(CAPABILITIES.stalwart, "x:AccountPassword/set", {
    accountId: client.mailAccountId,
    update: {
      [ACCOUNT_PASSWORD_ID]: {
        currentSecret: currentPassword,
        secret: newPassword,
      },
    },
  });
  const failed = result.notUpdated?.[ACCOUNT_PASSWORD_ID];
  if (failed) {
    throw new JmapError(String(failed.description ?? "The password could not be changed."), String(failed.type ?? "notUpdated"));
  }
  if (!result.updated || !(ACCOUNT_PASSWORD_ID in result.updated)) {
    throw new JmapError("The server did not confirm the password change.", "notUpdated");
  }
}
