import { cwd } from "node:process";

import { formatOperatorInitReport } from "../src/install/formatters.js";
import { initExitCode, runOperatorInit } from "../src/install/operator-init.js";

const result = runOperatorInit(cwd());
console.log(formatOperatorInitReport(result));
process.exit(initExitCode(result));
