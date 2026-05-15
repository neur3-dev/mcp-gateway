import { keysCreate, keysList, keysRevoke } from "./commands/keys";
import { policyAdd, policyList, policyRemove } from "./commands/policy";
import { auditList } from "./commands/audit";
import { printError } from "./display";

const args = process.argv.slice(2);
const [cmd, sub, ...rest] = args;

const USAGE = `Usage:
  mgw keys create --name <name> --caller <caller-id> [--rounds <n>]
  mgw keys list
  mgw keys revoke <key-id>
  mgw policy add --caller <caller-id> --pattern <pattern> --effect <allow|deny>
  mgw policy list [--caller <caller-id>]
  mgw policy remove <policy-id>
  mgw audit list [--caller <caller-id>] [--limit <n>]`;

async function main(): Promise<void> {
  if (cmd === "keys" && sub === "create") {
    await keysCreate(rest);
  } else if (cmd === "keys" && sub === "list") {
    await keysList();
  } else if (cmd === "keys" && sub === "revoke") {
    await keysRevoke(rest);
  } else if (cmd === "policy" && sub === "add") {
    await policyAdd(rest);
  } else if (cmd === "policy" && sub === "list") {
    await policyList(rest);
  } else if (cmd === "policy" && sub === "remove") {
    await policyRemove(rest);
  } else if (cmd === "audit" && sub === "list") {
    await auditList(rest);
  } else {
    process.stderr.write(USAGE + "\n");
    process.exit(1);
  }
}

main().catch((err) => {
  printError(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
