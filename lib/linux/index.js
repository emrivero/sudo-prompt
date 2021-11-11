const { EscapeDoubleQuotes } = require("../utils");
const {
  PERMISSION_DENIED,
  NO_POLKIT_AGENT,
  MAX_BUFFER,
} = require("../constants");
const fs = require("fs");
const child = require("child_process");

function LinuxBinary(instance, end) {
  var index = 0;
  // We used to prefer gksudo over pkexec since it enabled a better prompt.
  // However, gksudo cannot run multiple commands concurrently.
  var paths = ["/usr/bin/kdesudo", "/usr/bin/pkexec"];
  function test() {
    if (index === paths.length) {
      return end(new Error("Unable to find pkexec or kdesudo."));
    }
    var path = paths[index++];
    fs.stat(path, function (error) {
      if (error) {
        if (error.code === "ENOTDIR") return test();
        if (error.code === "ENOENT") return test();
        end(error);
      } else {
        end(undefined, path);
      }
    });
  }
  test();
}

function Linux(instance, end, afterPrompt) {
  LinuxBinary(instance, function (error, binary) {
    if (error) return end(error);
    var command = [];
    // Preserve current working directory:
    command.push('cd "' + EscapeDoubleQuotes(process.cwd()) + '";');
    // Export environment variables:
    for (var key in instance.options.env) {
      var value = instance.options.env[key];
      command.push("export " + key + '="' + EscapeDoubleQuotes(value) + '";');
    }
    command.push('"' + EscapeDoubleQuotes(binary) + '"');
    if (/kdesudo/i.test(binary)) {
      command.push(
        "--comment",
        '"' +
          instance.options.name +
          " wants to make changes. " +
          'Enter your password to allow this."'
      );
      command.push("-d"); // Do not show the command to be run in the dialog.
      command.push("--");
    } else if (/pkexec/i.test(binary)) {
      command.push("--disable-internal-agent");
    }
    var magic = "SUDOPROMPT\n";
    command.push(
      '/bin/bash -c "echo ' +
        EscapeDoubleQuotes(magic.trim()) +
        "; " +
        EscapeDoubleQuotes(instance.command) +
        '"'
    );
    command = command.join(" ");
    console.log(command);
    const execution = child.exec(
      command,
      { encoding: "utf-8", maxBuffer: MAX_BUFFER },
      function (error, stdout, stderr) {
        // ISSUE 88:
        // We must distinguish between elevation errors and command errors.
        //
        // KDESUDO:
        // kdesudo provides no way to do this. We add a magic marker to know
        // if elevation succeeded. Any error thereafter is a command error.
        //
        // PKEXEC:
        // "Upon successful completion, the return value is the return value of
        // PROGRAM. If the calling process is not authorized or an
        // authorization could not be obtained through authentication or an
        // error occured, pkexec exits with a return value of 127. If the
        // authorization could not be obtained because the user dismissed the
        // authentication dialog, pkexec exits with a return value of 126."
        //
        // However, we do not rely on pkexec's return of 127 since our magic
        // marker is more reliable, and we already use it for kdesudo.
        var elevated = stdout && stdout.slice(0, magic.length) === magic;
        if (elevated) stdout = stdout.slice(magic.length);
        // Only normalize the error if it is definitely not a command error:
        // In other words, if we know that the command was never elevated.
        // We do not inspect error messages beyond NO_POLKIT_AGENT.
        // We cannot rely on English errors because of internationalization.
        if (error && !elevated) {
          if (/No authentication agent found/.test(stderr)) {
            error.message = NO_POLKIT_AGENT;
          } else {
            error.message = PERMISSION_DENIED;
          }
        }
        end(error, stdout, stderr);
      }
    );

    execution.stdout.on("data", afterPrompt);
  });
}

module.exports = Linux;
