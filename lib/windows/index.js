const os = require("os");
const path = require("path");
const fs = require("fs");
const { PERMISSION_DENIED } = require("../constants");
const { UUID, Remove } = require("../utils");
const child = require("child_process");

function Windows(instance, callback, afterPrompt) {
  var temp = os.tmpdir();
  if (!temp) return callback(new Error("os.tmpdir() not defined."));
  UUID(instance, function (error, uuid) {
    if (error) return callback(error);
    instance.uuid = uuid;
    instance.path = path.join(temp, instance.uuid);
    if (/"/.test(instance.path)) {
      // We expect double quotes to be reserved on Windows.
      // Even so, we test for this and abort if they are present.
      return callback(new Error("instance.path cannot contain double-quotes."));
    }
    instance.pathElevate = path.join(instance.path, "elevate.vbs");
    instance.pathExecute = path.join(instance.path, "execute.bat");
    instance.pathCommand = path.join(instance.path, "command.bat");
    instance.pathStdout = path.join(instance.path, "stdout");
    instance.pathStderr = path.join(instance.path, "stderr");
    instance.pathStatus = path.join(instance.path, "status");
    fs.mkdir(instance.path, function (error) {
      if (error) return callback(error);
      function end(error, stdout, stderr) {
        Remove(instance.path, function (errorRemove) {
          if (error) return callback(error);
          if (errorRemove) return callback(errorRemove);
          callback(undefined, stdout, stderr);
        });
      }
      WindowsWriteExecuteScript(instance, function (error) {
        if (error) return end(error);
        WindowsWriteCommandScript(instance, function (error) {
          if (error) return end(error);
          WindowsElevate(instance, function (error, stdout, stderr) {
            if (error) return end(error, stdout, stderr);
            WindowsWaitForStatus(instance, function (error) {
              if (error) return end(error);
              WindowsResult(instance, end);
            });
            let idInterval = 0;
            idInterval = setInterval(() => {
              try {
                const chunk = fs.readFileSync(instance.pathStdout, "utf-8");
                afterPrompt(chunk);
              } catch (e) {
                clearInterval(idInterval);
              }
            }, instance.options.pollDelay);
          });
        });
      });
    });
  });
}

function WindowsElevate(instance, end) {
  // We used to use this for executing elevate.vbs:
  // var command = 'cscript.exe //NoLogo "' + instance.pathElevate + '"';
  var command = [];
  command.push("powershell.exe");
  command.push("Start-Process");
  command.push("-FilePath");
  // Escape characters for cmd using double quotes:
  // Escape characters for PowerShell using single quotes:
  // Escape single quotes for PowerShell using backtick:
  // See: https://ss64.com/ps/syntax-esc.html
  command.push("\"'" + instance.pathExecute.replace(/'/g, "`'") + "'\"");
  command.push("-WindowStyle hidden");
  command.push("-Verb runAs");
  command = command.join(" ");
  var execution = child.exec(
    command,
    { encoding: "utf-8" },
    function (error, stdout, stderr) {
      // We used to return PERMISSION_DENIED only for error messages containing
      // the string 'canceled by the user'. However, Windows internationalizes
      // error messages (issue 96) so now we must assume all errors here are
      // permission errors. This seems reasonable, given that we already run the
      // user's command in a subshell.
      if (error) return end(new Error(PERMISSION_DENIED), stdout, stderr);
      end(stdout);
    }
  );
  execution.stdin.end(); // Otherwise PowerShell waits indefinitely on Windows 7.
}

function WindowsResult(instance, end) {
  fs.readFile(instance.pathStatus, "utf-8", function (error, code) {
    if (error) return end(error);
    fs.readFile(instance.pathStdout, "utf-8", function (error, stdout) {
      if (error) return end(error);
      fs.readFile(instance.pathStderr, "utf-8", function (error, stderr) {
        if (error) return end(error);
        code = parseInt(code.trim(), 10);
        if (code === 0) {
          end(undefined, stdout, stderr);
        } else {
          error = new Error(
            "Command failed: " + instance.command + "\r\n" + stderr
          );
          error.code = code;
          end(error, stdout, stderr);
        }
      });
    });
  });
}

function WindowsWaitForStatus(instance, end) {
  // VBScript cannot wait for the elevated process to finish so we have to poll.
  // VBScript cannot return error code if user does not grant permission.
  // PowerShell can be used to elevate and wait on Windows 10.
  // PowerShell can be used to elevate on Windows 7 but it cannot wait.
  // powershell.exe Start-Process cmd.exe -Verb runAs -Wait
  fs.stat(instance.pathStatus, function (error, stats) {
    if ((error && error.code === "ENOENT") || stats.size < 2) {
      // Retry if file does not exist or is not finished writing.
      // We expect a file size of 2. That should cover at least "0\r".
      // We use a 1 second timeout to keep a light footprint for long-lived
      // sudo-prompt processes.
      setTimeout(function () {
        // If administrator has no password and user clicks Yes, then
        // PowerShell returns no error and execute (and command) never runs.
        // We check that command output has been redirected to stdout file:
        fs.stat(instance.pathStdout, function (error) {
          if (error) return end(new Error(PERMISSION_DENIED));
          WindowsWaitForStatus(instance, end);
        });
      }, 1000);
    } else if (error) {
      end(error);
    } else {
      end();
    }
  });
}

function WindowsWriteCommandScript(instance, end) {
  var cwd = process.cwd();
  if (/"/.test(cwd)) {
    // We expect double quotes to be reserved on Windows.
    // Even so, we test for this and abort if they are present.
    return end(new Error("process.cwd() cannot contain double-quotes."));
  }
  var script = [];
  // script.push("@echo off");
  // Set code page to UTF-8:
  script.push("chcp 65001>nul");
  // Preserve current working directory:
  // We pass /d as an option in case the cwd is on another drive (issue 70).
  script.push('cd /d "' + cwd + '"');
  // Export environment variables:
  for (var key in instance.options.env) {
    // "The characters <, >, |, &, ^ are special command shell characters, and
    // they must be preceded by the escape character (^) or enclosed in
    // quotation marks. If you use quotation marks to enclose a string that
    // contains one of the special characters, the quotation marks are set as
    // part of the environment variable value."
    // In other words, Windows assigns everything that follows the equals sign
    // to the value of the variable, whereas Unix systems ignore double quotes.
    var value = instance.options.env[key];
    script.push("set " + key + "=" + value.replace(/([<>\\|&^])/g, "^$1"));
  }
  script.push(instance.command);
  script = script.join("\r\n");
  fs.writeFile(instance.pathCommand, script, "utf-8", end);
}

function WindowsWriteExecuteScript(instance, end) {
  var script = [];
  // script.push("@echo off");
  script.push(
    'call "' +
      instance.pathCommand +
      '"' +
      ' > "' +
      instance.pathStdout +
      '" 2> "' +
      instance.pathStderr +
      '"'
  );
  script.push('(echo %ERRORLEVEL%) > "' + instance.pathStatus + '"');
  script = script.join("\r\n");
  fs.writeFile(instance.pathExecute, script, "utf-8", end);
}

module.exports = Windows;
