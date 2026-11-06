/**
 * The Gmail helper: a Google Apps Script the distributor pastes into script.google.com once, signed in to the
 * Gmail account that receives CAMS and KFintech mailbacks. It runs under their own Google account (no third-party
 * app), every 15 minutes, and sends new mailbacks' attachments to Folio. The first run also sends the last 90 days.
 *
 * Folio only accepts what comes from the registrars and opens with the saved ZIP passwords, and never imports the
 * same email twice, so running it again is harmless.
 */
export function gmailHelperScript(endpoint: string, token: string): string {
  return `// FundVault / Anqulas Folio: sends CAMS and KFintech mailbacks from this Gmail to Folio.
// Setup: paste into a new project at script.google.com, Save, choose "setup" above, click Run, and allow access.
// It then runs by itself every 15 minutes. To stop it: Triggers (clock icon on the left) > delete the trigger.

const FOLIO_URL = ${JSON.stringify(endpoint)};
const FOLIO_KEY = ${JSON.stringify(token)}; // Private to your practice. Don't share this script.
const SEARCH = "from:(camsonline.com OR kfintech.com OR karvy.com) has:attachment";

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("sendToFolio").timeBased().everyMinutes(15).create();
  sendToFolio();
}

function sendToFolio() {
  const props = PropertiesService.getScriptProperties();
  const firstRun = !props.getProperty("started");
  const sent = JSON.parse(props.getProperty("sent") || "[]");
  const query = SEARCH + (firstRun ? " newer_than:90d" : " newer_than:3d");
  const started = Date.now();
  let count = 0;
  let unfinished = false;
  for (let page = 0; page < 20 && Date.now() - started < 4.5 * 60 * 1000; page++) {
    const threads = GmailApp.search(query, page * 50, 50);
    if (!threads.length) break;
    threads.forEach(function (thread) {
      thread.getMessages().forEach(function (m) {
        const id = m.getId();
        if (sent.indexOf(id) >= 0) return;
        if (Date.now() - started > 4.5 * 60 * 1000) { unfinished = true; return; }
        const files = m.getAttachments({ includeInlineImages: false }).filter(function (a) {
          return /\\.(zip|dbf|csv|txt|xls|xlsx)$/i.test(a.getName()) && a.getSize() < 15000000;
        });
        if (files.length) {
          const res = UrlFetchApp.fetch(FOLIO_URL, {
            method: "post",
            contentType: "application/json",
            headers: { Authorization: "Bearer " + FOLIO_KEY },
            muteHttpExceptions: true,
            payload: JSON.stringify({
              messageId: id,
              from: m.getFrom(),
              subject: m.getSubject(),
              attachments: files.map(function (a) { return { name: a.getName(), data: Utilities.base64Encode(a.getBytes()) }; }),
            }),
          });
          if (res.getResponseCode() >= 500) { unfinished = true; return; } // try again next time
          if (res.getResponseCode() === 401) throw new Error("Folio didn't accept this script's key. Make a new script in Folio > Settings > Email import.");
          count++;
        }
        sent.push(id);
      });
    });
  }
  props.setProperty("sent", JSON.stringify(sent.slice(-400))); // Script properties hold about 9 KB; Folio skips repeats anyway.
  // The first, 90-day run may take a few turns; only then switch to recent emails.
  if (!unfinished) props.setProperty("started", "yes");
  console.log("Sent " + count + " mailbacks to Folio.");
}
`;
}
