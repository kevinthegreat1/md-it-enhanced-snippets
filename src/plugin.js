import {cwd} from 'node:process';
import {existsSync, readFileSync} from "fs";

const TRANSCLUDE_WITH = "TRANSCLUDE_WITH";
const TRANSCLUDE_LINE = "TRANSCLUDE_LINE";
const TRANSCLUDE_TAG = "TRANSCLUDE_TAG";

export default function (md, options) {
  const _root = options && options.root ? options.root : cwd();

  const fileExists = (f) => {
    return existsSync(f);
  };

  const _readFileSync = (f) => {
    return fileExists(f) ? readFileSync(f, "utf8") : `Not Found: ${f}`;
  };

  const parseOptions = (opts) => {
    const _t = {};
    opts
      .trim()
      .split(" ")
      .forEach((pair) => {
        const [opt, value] = pair.split("=");
        _t[opt] = value;
      });
    return _t;
  };

  const dataFactory = (state, pos, max) => {
    const start = pos + 6;
    const end = state.skipSpacesBack(max, pos) - 1;
    const [opts, fullpathWithAtSym] = state.src
      .slice(start, end)
      .trim()
      .split("](");
    const fullpath = fullpathWithAtSym.replace(/^@/, _root).trim();
    const pathParts = fullpath.split("/");
    const fileParts = pathParts[pathParts.length - 1].split(".");

    return {
      file: {
        resolve: fullpath,
        path: pathParts.slice(0, pathParts.length - 1).join("/"),
        name: fileParts.slice(0, fileParts.length - 1).join("."),
        ext: fileParts[fileParts.length - 1],
      },
      options: parseOptions(opts),
      fileExists: fileExists(fullpath),
    };
  };

  const optionsMap = ({ options }) => ({
    hasHighlight: options.highlight || false,
    hasTransclusion:
      options.transclude ||
      options.transcludeWith ||
      options.transcludeTag ||
      false,
    get transclusionType() {
      if (options.transcludeWith) return TRANSCLUDE_WITH;
      if (options.transcludeTag) return TRANSCLUDE_TAG;
      if (options.transclude) return TRANSCLUDE_LINE;
    },
    get meta() {
      return this.hasHighlight ? options.highlight : "";
    },
  });

  const contentTransclusion = (content, options, transcludeType) => {
    const lines = content.split("\n");
    let _content = "";

    if (transcludeType === TRANSCLUDE_LINE) {
      const [tStart, tEnd] = options.transclude
        .replace(/[^\d|-]/g, "")
        .split("-");

      lines.forEach((line, idx) => {
        const i = idx + 1;
        if (i >= tStart && i <= tEnd) {
          _content += line + "\n";
        }
      });
    } else if (transcludeType === TRANSCLUDE_TAG) {
      const t = options.transcludeTag;
      const tag = new RegExp(`${t}>$|^<${t}`);
      let matched = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (matched && tag.test(line)) {
          _content += line + "\n";
          break;
        } else if (matched) {
          _content += line + "\n";
        } else if (tag.test(line)) {
          _content += line + "\n";
          matched = true;
        }
      }
    } else if (transcludeType === TRANSCLUDE_WITH) {
      const t = options.transcludeWith;
      const tag = new RegExp(t);
      let matched = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (tag.test(line)) {
          matched = !matched;
          continue;
        }

        if (matched) {
          _content += line + "\n";
        }
      }
    }

    if (_content === "") {
      return "No lines matched.";
    }

    if (options.dontTrim) {
      return _content;
    }

    const _contentLines = _content.split("\n");
    let leadingWhitespaceLength = Infinity;

    // Find the shortest leading width of whitespace at the start of a line.
    _contentLines.forEach((line) => {
      // Ignore lines that fully consist of whitespace.
      if (line.match(/^\s*$/)) return;

      const leadingWhitespace = line.match(/^(\s*)/)[0];
      if (leadingWhitespace.length < leadingWhitespaceLength) {
        leadingWhitespaceLength = leadingWhitespace.length;
      }
    });

    // Remove leading whitespace from each line at the start, only if the line has leading whitespace of the same length or more.
    _contentLines.forEach((line, idx) => {
      const leadingWhitespace = line.match(/^(\s*)/)[0];
      if (leadingWhitespace.length >= leadingWhitespaceLength) {
        _contentLines[idx] = line.slice(leadingWhitespaceLength);
      }
    });

    _content = _contentLines.join("\n");

    return _content;
  };

  function parser(state, startLine, endLine, silent) {
    const matcher = [64, 91, 99, 111, 100, 101]; // @[code
    const pos = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];

    if (state.sCount[startLine] - state.blkIndent >= 4) {
      return false;
    }

    for (let i = 0; i < 6; ++i) {
      const ch = state.src.charCodeAt(pos + i);
      if (ch !== matcher[i] || pos + i >= max) return false;
    }

    if (silent) return true;

    // handle code snippet include
    const d = dataFactory(state, pos, max);
    const opts = optionsMap(d);

    const token = state.push("fence", "code", 0);
    // The `info` string contains the language (or file extension) and highlight lines (e.g. "1-2" or an empty string) for the highlighter to use.
    token.info = (d.options.lang || d.file.ext) + opts.meta;
    // Only store metadata in the token, don't load the file yet.
    // Otherwise, the token contains the entire file, taking up memory.
    token.meta = {md_it_enhanced_snippets: {d, opts}}; // Custom object using our plugin name to minimize the chance of conflicts.
    token.markup = "```";
    token.map = [startLine, startLine + 1];

    state.line = startLine + 1;
    return true;
  }

  md.block.ruler.before("fence", "snippet", parser);

  // We wrap the fence renderer rule to load transclusion contents during render.
  const fence = md.renderer.rules.fence;
  // Throw an error if the fence render rule is gone.
  if (!fence) {
    throw new Error("md.renderer.rules.fence is not defined. md_it_enhanced_snippets needs the fence render rule!");
  }
  md.renderer.rules.fence = function (tokens, idx, options, env, self) {
    const t = tokens[idx];
    if (t && t.meta && t.meta.md_it_enhanced_snippets) {
      const {d, opts} = t.meta.md_it_enhanced_snippets;
      const content = _readFileSync(d.file.resolve);
      t.content =
        d.fileExists && opts.hasTransclusion
          ? contentTransclusion(content, d.options, opts.transclusionType)
          : content;

      const htmlContent = fence(tokens, idx, options, env, self);
      t.content = '';
      return htmlContent;
    }
    return fence(tokens, idx, options, env, self);
  };
};
