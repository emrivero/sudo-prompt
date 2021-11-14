const Mac = require("./lib/mac");
const Linux = require("./lib/linux");
const Windows = require("./lib/windows");
const { ValidName } = require("./lib/utils");
const util = require("util");

function Attempt(instance, end, afterPrompt) {
  var platform = process.platform;
  if (platform === "darwin") return Mac(instance, end);
  if (platform === "linux") return Linux(instance, end, afterPrompt);
  if (platform === "win32") return Windows(instance, end, afterPrompt);
  end(new Error("Platform not yet supported."));
}

function Exec(command, options, end, afterPrompt) {
  if (/^sudo/i.test(command)) {
    return end(new Error('Command should not be prefixed with "sudo".'));
  }
  if (typeof options.name === "undefined") {
    var title = process.title;
    if (ValidName(title)) {
      options.name = title;
    } else {
      return end(new Error("process.title cannot be used as a valid name."));
    }
  } else if (!ValidName(options.name)) {
    var error = "";
    error += "options.name must be alphanumeric only ";
    error += "(spaces are allowed) and <= 70 characters.";
    return end(new Error(error));
  }
  if (typeof options.icns !== "undefined") {
    if (typeof options.icns !== "string") {
      return end(new Error("options.icns must be a string if provided."));
    } else if (options.icns.trim().length === 0) {
      return end(new Error("options.icns must not be empty if provided."));
    }
  }
  if (typeof options.env !== "undefined") {
    if (typeof options.env !== "object") {
      return end(new Error("options.env must be an object if provided."));
    } else if (Object.keys(options.env).length === 0) {
      return end(new Error("options.env must not be empty if provided."));
    } else {
      for (var key in options.env) {
        var value = options.env[key];
        if (typeof key !== "string" || typeof value !== "string") {
          return end(
            new Error("options.env environment variables must be strings.")
          );
        }
        // "Environment variable names used by the utilities in the Shell and
        // Utilities volume of IEEE Std 1003.1-2001 consist solely of uppercase
        // letters, digits, and the '_' (underscore) from the characters defined
        // in Portable Character Set and do not begin with a digit. Other
        // characters may be permitted by an implementation; applications shall
        // tolerate the presence of such names."
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
          return end(
            new Error(
              "options.env has an invalid environment variable name: " +
                JSON.stringify(key)
            )
          );
        }
        if (/[\r\n]/.test(value)) {
          return end(
            new Error(
              "options.env has an invalid environment variable value: " +
                JSON.stringify(value)
            )
          );
        }
      }
    }
  }
  var platform = process.platform;
  if (platform !== "darwin" && platform !== "linux" && platform !== "win32") {
    return end(new Error("Platform not yet supported."));
  }
  var instance = {
    command: command,
    options: options,
    uuid: undefined,
    path: undefined,
  };
  Attempt(instance, end, afterPrompt);
}

module.exports.exec = Exec;
