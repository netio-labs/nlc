import type en from "../en";
import common from "./common.json";
import header from "./header.json";
import login from "./login.json";
import home from "./home.json";
import labs from "./labs.json";
import settings from "./settings.json";
import account from "./account.json";
import editor from "./editor.json";
import viewer from "./viewer.json";
import consoleNs from "./console.json"; // `console` would shadow the global
import capture from "./capture.json";
import docs from "./docs.json";
import errors from "./errors.json";
import topo from "./topo.json";

// Typed against English so a missing key fails tsc.
const messages: typeof en = { common, header, login, home, labs, settings, account, editor, viewer, console: consoleNs, capture, docs, errors, topo };
export default messages;
