const sudo = require("./");
const child = require("child_process");

sudo.exec(
  "choco install 7zip.install -y",
  { name: "app", pollDelay: 1000 },
  console.log,
  (chunk) => {
    console.log(chunk);
    console.log("-------------------------------------------------");
  }
);
