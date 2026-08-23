# How to sign in to the WebUI and send email

This guide shows a WebUI user how to connect a Stalwart account and send a
first message. It does not cover server installation or administration.

## Before you start

Ask your mail administrator for:

- the public WebUI address, such as `https://webmail.example.com/`;
- the Stalwart mail-server address, such as `https://mail.example.com`;
- your full email address or account name; and
- your password, app password, or instructions for signing in with Stalwart.

Your administrator must create your account, assign it an email address, and
enable mail submission before you can send email. Use only trusted HTTPS
addresses. Do not open the Stalwart `/admin/` page unless you are an
administrator.

The WebUI address and mail-server address may look similar, but they serve
different purposes:

| Address | Example | Purpose |
| --- | --- | --- |
| WebUI | `https://webmail.example.com/` | The website you open in your browser |
| Mail server | `https://mail.example.com` | The Stalwart server shown on the sign-in form |

## 1. Sign in

1. Open the WebUI address in a current web browser.
2. Check the **Mail server** field. It is normally filled in for you. If it is
   editable, enter the Stalwart mail-server address, not the WebUI address.
3. Use the sign-in method provided by your administrator:

   - Select **Continue with Stalwart** to sign in through Stalwart's
     authorization page; or
   - enter your full address or account name in **Email or account name**, enter
     your password or app password, and select **Connect with password**.

4. Wait for the **Mail** screen to open. The account area should show your
   username and **Connected**.

If both sign-in methods are available, follow your organization's instructions.
An app password is usually the right choice when your account uses two-factor
authentication and you are not using **Continue with Stalwart**.

## 2. Write a message

1. Select **Compose** in the sidebar. On a small screen, select **Compose** in
   the bottom navigation bar.
2. Check the read-only **From** address. The WebUI uses the first sending
   identity supplied by your Stalwart account.
3. Enter at least one recipient in **To**. Separate multiple email addresses
   with commas.
4. Optionally add recipients in **Cc**.
5. Enter a **Subject** and write your text in **Message body**.
6. To include files, select **Attach files** and choose one or more files. Use
   the remove button beside an attachment if you selected it by mistake.

The WebUI saves your work automatically after you start writing. Before leaving
the composer, wait for the status at the top to change from **Saving…** to
**Saved to Drafts**. Select **Discard** only when you want to delete the draft.

## 3. Send and verify the message

1. Select **Send** at the top of the composer.
2. Wait while the button displays **Sending…**.
3. Confirm that **Message sent** appears and the WebUI returns to the Mail
   screen.

For your first test, send a message to an address you can check. Confirm that it
arrives in the recipient's inbox, and check the spam or junk folder if it does
not appear immediately. Your Stalwart server, not the browser, performs the
final delivery.

If sending fails, the WebUI leaves the message in Drafts and displays the server
error. Do not select **Discard**. Correct the problem and try again.

## Sign out

Select **Sign out** at the bottom of the sidebar. On a small screen, open
**Settings** and select **Sign out**.

## Change your password

1. Open **Settings**.
2. Under **Password**, enter your current password, a new password, and the new
   password again.
3. Select **Change password**.

The new password must be at least 8 characters; the server may require a
stronger one. After a successful change you stay signed in on this device. If
the account is stored in an external directory such as LDAP, password changes
are not available here — ask your administrator.

If you stay signed in, this device keeps your sign-in so you do not have to
enter it after a refresh. Always sign out when using a shared device.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| **The server rejected those credentials.** | Re-enter your full email address or account name and password. If two-factor authentication is enabled, try an app password or **Continue with Stalwart**. Ask the administrator to verify or reset the account if it still fails. |
| **The browser could not reach JMAP.** | Confirm the mail-server address uses HTTPS and has a trusted certificate. If the address is correct, ask the administrator to check Stalwart, the proxy, and the WebUI origin allow-list. |
| **OAuth client registration is disabled.** | Use an app password if password sign-in is available, or ask the administrator to enable/register WebUI authorization. |
| **Compose** is missing | Open **Settings** and check **JMAP capabilities**. If **Sending** is **Not advertised**, ask the administrator to enable mail submission for the account or server. |
| **Sending is unavailable** | The account has no sending identity or Drafts mailbox. Ask the administrator to assign an email address and check the account's default mailboxes. |
| **Add at least one recipient.** | Enter a recipient in **To**, then select **Send** again. |
| **Save failed** or the connection shows **Offline** | Restore the network connection and wait for **Saved to Drafts** before closing or refreshing the page. |
| **Message could not be sent. Your draft is safe.** | Keep the draft, retry once, and send the displayed error to the administrator if it continues. |
| The WebUI says **Message sent**, but the recipient has no message | Verify the recipient address and check spam or junk. The administrator can inspect Stalwart's outbound queue and the domain's DNS and delivery configuration. |

For a support request, open **Settings**, select **Open diagnostics**, and then
select **Copy diagnostics**. The copied report includes connection and feature
information but excludes credentials, tokens, and message content.

## Related guides

- [How to install Stalwart and the Mail/Calendar WebUI](INSTALL.md)
- [WebUI technical documentation](../webui/README.md)
