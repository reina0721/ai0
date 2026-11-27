type Token =
  | { kind: "num"; value: number }
  | { kind: "id"; name: string }
  | { kind: "op"; op: "+" | "-" | "*" | "/" | "%" | "**" }
  | { kind: "lparen" }
  | { kind: "rparen" }
  | { kind: "comma" };

const MATH_CONSTANTS: Readonly<Record<string, number>> = {
  PI: Math.PI,
  pi: Math.PI,
  E: Math.E,
  e: Math.E
};

const MATH_FUNCTIONS: Readonly<Record<string, (...args: number[]) => number>> = {
  abs: (x) => Math.abs(x!),
  sqrt: (x) => Math.sqrt(x!),
  cbrt: (x) => Math.cbrt(x!),
  round: (x) => Math.round(x!),
  floor: (x) => Math.floor(x!),
  ceil: (x) => Math.ceil(x!),
  trunc: (x) => Math.trunc(x!),
  exp: (x) => Math.exp(x!),
  ln: (x) => Math.log(x!),
  log: (x, base) => (base === undefined ? Math.log10(x!) : Math.log(x!) / Math.log(base)),
  sin: (x) => Math.sin(x!),
  cos: (x) => Math.cos(x!),
  tan: (x) => Math.tan(x!),
  pow: (x, y) => Math.pow(x!, y!),
  min: (...xs) => Math.min(...xs),
  max: (...xs) => Math.max(...xs)
};

function tokenizeMath(expr: string): Token[] {
  if (expr.length > 512) {
    throw new Error("Expression exceeds maximum length (512)");
  }
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i]!;
    if (/\s/u.test(ch)) {
      i += 1;
      continue;
    }
    if (/\d/u.test(ch) || (ch === "." && /\d/u.test(expr[i + 1] ?? ""))) {
      const match = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/u.exec(expr.slice(i));
      if (!match) throw new Error(`Invalid number at position ${i}`);
      const value = Number(match[0]);
      if (!Number.isFinite(value)) throw new Error(`Numeric literal overflow at position ${i}`);
      tokens.push({ kind: "num", value });
      i += match[0].length;
      continue;
    }
    if (/[a-zA-Z_]/u.test(ch)) {
      const match = /^[a-zA-Z_][a-zA-Z0-9_]*/u.exec(expr.slice(i))!;
      tokens.push({ kind: "id", name: match[0] });
      i += match[0].length;
      continue;
    }
    if (ch === "*" && expr[i + 1] === "*") {
      tokens.push({ kind: "op", op: "**" });
      i += 2;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === "%") {
      tokens.push({ kind: "op", op: ch });
      i += 1;
      continue;
    }
    if (ch === "(") {
      tokens.push({ kind: "lparen" });
      i += 1;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "rparen" });
      i += 1;
      continue;
    }
    if (ch === ",") {
      tokens.push({ kind: "comma" });
      i += 1;
      continue;
    }
    throw new Error(`Unexpected character '${ch}' at position ${i}`);
  }
  return tokens;
}

/**
 * Pure deterministic recursive-descent mathematical evaluator (zero eval / Function).
 */
export function evaluateSafeMathExpression(expression: string): number {
  const tokens = tokenizeMath(expression);
  if (tokens.length === 0) throw new Error("Empty expression");
  let pos = 0;

  const peek = () => tokens[pos];
  const consume = () => tokens[pos++];

  const parseExpression = (): number => {
    let left = parseTerm();
    while (true) {
      const next = peek();
      if (next?.kind === "op" && (next.op === "+" || next.op === "-")) {
        consume();
        const right = parseTerm();
        left = next.op === "+" ? left + right : left - right;
      } else {
        break;
      }
    }
    return left;
  };

  const parseTerm = (): number => {
    let left = parsePower();
    while (true) {
      const next = peek();
      if (next?.kind === "op" && (next.op === "*" || next.op === "/" || next.op === "%")) {
        consume();
        const right = parsePower();
        if ((next.op === "/" || next.op === "%") && right === 0) {
          throw new Error("Division or modulo by zero");
        }
        left = next.op === "*" ? left * right : next.op === "/" ? left / right : left % right;
      } else {
        break;
      }
    }
    return left;
  };

  const parsePower = (): number => {
    const base = parseUnary();
    const next = peek();
    if (next?.kind === "op" && next.op === "**") {
      consume();
      const exponent = parsePower(); // right-associative
      return Math.pow(base, exponent);
    }
    return base;
  };

  const parseUnary = (): number => {
    const next = peek();
    if (next?.kind === "op" && (next.op === "+" || next.op === "-")) {
      consume();
      const val = parseUnary();
      return next.op === "-" ? -val : val;
    }
    return parsePrimary();
  };

  const parsePrimary = (): number => {
    const tok = consume();
    if (!tok) throw new Error("Unexpected end of expression");
    if (tok.kind === "num") return tok.value;
    if (tok.kind === "lparen") {
      const inner = parseExpression();
      if (consume()?.kind !== "rparen") throw new Error("Missing closing parenthesis ')'");
      return inner;
    }
    if (tok.kind === "id") {
      if (peek()?.kind === "lparen") {
        consume(); // '('
        const fn = MATH_FUNCTIONS[tok.name];
        if (!fn) throw new Error(`Unsupported math function: ${tok.name}`);
        const args: number[] = [];
        if (peek()?.kind !== "rparen") {
          args.push(parseExpression());
          while (peek()?.kind === "comma") {
            consume();
            args.push(parseExpression());
          }
        }
        if (consume()?.kind !== "rparen") throw new Error(`Missing ')' in call to ${tok.name}`);
        if (args.length === 0) throw new Error(`Function ${tok.name} requires at least one argument`);
        return fn(...args);
      }
      if (Object.hasOwn(MATH_CONSTANTS, tok.name)) {
        return MATH_CONSTANTS[tok.name]!;
      }
      throw new Error(`Unknown identifier: ${tok.name}`);
    }
    throw new Error("Unexpected token in expression");
  };

  const value = parseExpression();
  if (pos !== tokens.length) {
    throw new Error("Unexpected trailing tokens in expression");
  }
  if (!Number.isFinite(value)) {
    throw new Error("Expression evaluated to a non-finite number");
  }
  return value;
}
