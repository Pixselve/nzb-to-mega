import { Storage } from "megajs";
import * as fs from "fs";
import { SABnzbd } from "node-sabnzbd";

import path from "path";
import { Slot } from "node-sabnzbd/dist/History";
import clear from "clear";
import chalk from "chalk";
import figlet from "figlet";
import inquirer from "inquirer";
import { Spinner } from "clui";

import Conf from "conf";

const config = new Conf();

async function slotToMega(slot: Slot): Promise<string> {
  const directoryPath = fs.lstatSync(slot.storage).isDirectory()
    ? slot.storage
    : path.dirname(slot.storage);
  const folder = fs.readdirSync(directoryPath);
  const storage = await getStorage(
    "heavyset-assyria-unaware-carrion@recognitiontown.ml",
    "NIRT-psik2doop1bau"
  );
  const megaFolder: any = await new Promise((resolve, reject) =>
    storage.mkdir(slot.name, (err, file) => {
      if (err) {
        reject(err);
      } else {
        resolve(file);
      }
    })
  );

  await Promise.all(
    folder.map((el) => {
      return uploadToMEGA(el, directoryPath, megaFolder);
    })
  );

  return new Promise((resolve, reject) => {
    megaFolder.shareFolder({}, (err, url) => {
      if (err) {
        reject(err);
      } else {
        resolve(url);
      }
    });
  });
}

async function uploadToMEGA(fileName: string, path: string, megaFolder: any) {
  return new Promise((resolve, reject) => {
    const file = fs.createReadStream(`${ path }\\${ fileName }`);
    let written = 0;
    file.pipe(
      megaFolder.upload(fileName, (err, file) => {
        resolve(file);
      })
    );
    file.on("data", (chunk) => {
      written += chunk.length;
    });
  });
}

async function getStorage(
  username: string,
  password: string
): Promise<Storage> {
  return new Promise((resolve, reject) => {
    let storage = new Storage(
      { email: username, password: password },
      (value) => {
        resolve(storage);
      }
    );
  });
}

const questions = [
  {
    name: "email",
    type: "input",
    message: "Enter your MEGA e-mail address:",
    validate: function (value) {
      if (value.length) {
        return true;
      } else {
        return "Please enter your e-mail address.";
      }
    },
  },
  {
    name: "password",
    type: "password",
    message: "Enter your MEGA password:",
    validate: function (value) {
      if (value.length) {
        return true;
      } else {
        return "Please enter your MEGA password.";
      }
    },
  },
];

const status = new Spinner("Checking account, please wait...");

async function newMegaAccount(): Promise<{ email: string; password: string }> {
  const credentials = await inquirer.prompt(questions);

  status.start();
  let storage: Storage;
  try {
    storage = new Storage(credentials);
    console.log(chalk.green("✅ Account is valid !"));
  } catch (e) {
    console.error({ e });
    throw new Error("Error while login to MEGA");
  } finally {
    status.stop();
  }

  const existingAccounts: unknown[] = config.get("accounts", []) as unknown[];
  config.set("accounts", [...existingAccounts, credentials]);
  console.log(config.get("accounts"));

  return credentials;
}

async function cli() {
  clear();
  console.log(
    chalk.red(figlet.textSync("NZB to MEGA", { horizontalLayout: "full" }))
  );
  const accounts: { email: string; password: string }[] = config.get(
    "accounts",
    []
  ) as { email: string; password: string }[];
  let credentials;
  if (accounts.length > 0) {
    const { account } = await inquirer.prompt([
      {
        name: "account",
        message: "Select an account or create a new one:",
        type: "list",
        choices: [
          ...accounts.map((account, i) => ({ name: account.email, value: i })),
          {
            name: "Add a new one",
            value: -1,
          },
        ],
      },
    ]);
    if (account >= 0) {
      credentials = accounts[account];
    } else {
      credentials = await newMegaAccount();
    }
  } else {
    credentials = await newMegaAccount();
  }

  const { host, port, apiKey } = await inquirer.prompt([
    {
      name: "host",
      message: "Enter the SABnzbd host:",
      type: "input",
      default: config.get("sABnzbdHost", "127.0.0.1"),
      validate: function (value) {
        if (value.length) {
          return true;
        } else {
          return "Please enter the SABnzbd host.";
        }
      },
    },
    {
      name: "port",
      message: "Enter the SABnzbd port:",
      default: config.get("sABnzbdPort", "8080"),
      type: "input",
      validate: function (value) {
        if (value.length) {
          return true;
        } else {
          return "Please enter the SABnzbd port.";
        }
      },
    },
    {
      name: "apiKey",
      message: "Enter the SABnzbd api key:",
      type: "input",
      default: config.get("sABnzbdApiKey", null),
      validate: function (value) {
        if (value.length) {
          return true;
        } else {
          return "Please enter the SABnzbd api key.";
        }
      },
    },
  ]);

  config.set("sABnzbdHost", host)
  config.set("sABnzbdPort", port)
  config.set("sABnzbdApiKey", apiKey)


  status.message("Connecting to SABnzbd...");
  status.start();
  let sabnzb: SABnzbd;
  try {
    sabnzb = new SABnzbd(host, port, apiKey);
    const version = await sabnzb.version();
    console.log(chalk.green(`✅ Connected to SABnzbd version ${ version }`));
  } catch (e) {
    throw new Error("Can't connect to SABnzbd");
  } finally {
    status.stop();
  }

  const { nzb } = await inquirer.prompt([
    {
      name: "nzb",
      message: "Enter the nzb file url:",
      type: "input",
      validate: function (value) {
        if (value.length) {
          return true;
        } else {
          return "Please enter the nzb file url.";
        }
      },
    },
  ]);

  console.log("📁 Adding file to SABnzbd");
  status.message("Downloading files...");
  status.start();
  const ids = await sabnzb.addFileAndWaitTillFinish(nzb);
  status.stop();
  console.log(chalk.green("✅ Finished downloading"));

  const history = await sabnzb.history(ids);
  status.message("Uploading files to mega...");
  status.start();
  const urls = await Promise.all(history.slots.map(slotToMega));
  status.stop();
  console.log(`✅ Upload finished. File url: ${ urls }`);
  return;
}

cli().then();
