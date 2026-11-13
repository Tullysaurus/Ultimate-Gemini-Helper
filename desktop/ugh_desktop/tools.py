"""Calculator tools the model can call (OpenAI-style function calling through OpenRouter).

Three tools, kept broad so small models use them reliably:
  calculate   expressions: arithmetic, trig, logs, matrices, TI-84 style probability functions
  algebra     solve equations / systems / inequalities, simplify, factor, expand, derivative, integral, limit
  statistics  1-Var Stats (with frequencies) and 2-variable regressions

Screenshots are untrusted (text on screen can steer the model), so expressions are never run as
Python. Each is checked against a character whitelist (no quotes, no `__`, no attribute access)
and then parsed by SymPy with a namespace holding only the math functions below and no builtins.
The math runs in a separate process (see _ToolProcess) that imports SymPy in the background, so
app startup stays fast and a runaway calculation can be killed without freezing the UI.
"""

from __future__ import annotations

import json
import math
import re
import statistics as st
import threading
from typing import Any

TOOL_TIMEOUT_S = 10      # a runaway calculation (e.g. 9^9^9^9) is abandoned after this
MAX_EXPRESSION_LEN = 500

_PROB_HELP = (
    "Probability (TI-84 style): normalcdf(lower, upper, mean=0, sd=1), normalpdf(x, mean=0, sd=1), "
    "invnorm(area, mean=0, sd=1) (left-tail area), binompdf(n, p, k), binomcdf(n, p, k) (P(X<=k)), "
    "poissonpdf(mean, k), poissoncdf(mean, k), geometpdf(p, k), geometcdf(p, k), tcdf(lower, upper, df), "
    "invt(area, df), chi2cdf(lower, upper, df). Use 1e99 / -1e99 for unbounded limits."
)

TOOLS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "calculate",
            "description": (
                "Evaluate math expressions exactly and as decimals. Pass several at once when you can. "
                "Syntax: + - * / ^, implicit multiplication (2x), sqrt(x), root(x, n), abs(x), ln(x), "
                "log(x) (base 10), log(x, b), exp(x), sin/cos/tan/asin/acos/atan (radians), "
                "sind/cosd/tand/asind/acosd/atand (degrees), pi, e, factorial(n) or n!, nCr(n, r), nPr(n, r), "
                "floor, ceiling, round(x, digits), gcd, lcm. Matrices as [[1,2],[3,4]] with det(M), inv(M), "
                "rref(M), transpose(M), matmul(A, B). " + _PROB_HELP
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "expressions": {"type": "array", "items": {"type": "string"},
                                    "description": "e.g. [\"sqrt(50)/3\", \"normalcdf(-1, 1)\"]"},
                },
                "required": ["expressions"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "algebra",
            "description": (
                "Symbolic algebra and calculus. operation 'solve' takes equations (with =), expressions "
                "(= 0) or inequalities (<, <=, >, >=); several equations are solved as a system. "
                "Other operations: simplify, factor, expand, derivative, integral, limit. "
                "Same expression syntax as calculate (use ^ for powers, implicit multiplication is fine)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "operation": {"type": "string",
                                  "enum": ["solve", "simplify", "factor", "expand", "derivative", "integral", "limit"]},
                    "expressions": {"type": "array", "items": {"type": "string"},
                                    "description": "e.g. [\"2x + 3y = 7\", \"x - y = 1\"] or [\"x^2 sin(x)\"]"},
                    "variables": {"type": "array", "items": {"type": "string"},
                                  "description": "Variables to solve for / differentiate or integrate with respect to. "
                                                 "Optional: defaults to all symbols (solve) or the only symbol."},
                    "lower": {"type": "string", "description": "integral: lower bound (omit for indefinite)"},
                    "upper": {"type": "string", "description": "integral: upper bound"},
                    "point": {"type": "string", "description": "limit: the value approached, e.g. \"0\" or \"oo\""},
                    "direction": {"type": "string", "enum": ["+", "-", "+-"], "description": "limit: side"},
                    "order": {"type": "integer", "description": "derivative: order (default 1)"},
                },
                "required": ["operation", "expressions"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "statistics",
            "description": (
                "Statistics of a data list, like a TI-84. With just data: 1-Var Stats (n, sum, mean, median, "
                "mode, sample SD Sx and population SD σx, variances, min, Q1, Q3, max, range, IQR). "
                "Give frequencies for a frequency table. Give y as well for 2-variable stats and a "
                "regression (default linear) with r and r²."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "data": {"type": "array", "items": {"type": "number"}, "description": "values (or x values)"},
                    "frequencies": {"type": "array", "items": {"type": "number"},
                                    "description": "optional count for each value"},
                    "y": {"type": "array", "items": {"type": "number"}, "description": "optional y values"},
                    "regression": {"type": "string",
                                   "enum": ["linear", "quadratic", "cubic", "exponential", "power", "logarithmic"]},
                },
                "required": ["data"],
            },
        },
    },
]

TOOLS_PROMPT = """
CALCULATOR TOOLS:
You have calculator tools (calculate, algebra, statistics). Doing math yourself is slow and error-prone; the tools are instant and exact.
- Do NOT compute anything beyond one-step mental arithmetic (like 7 + 5) yourself. That includes means, standard deviations, quartiles, regressions, probabilities, solving equations or systems, derivatives, integrals, trig and log values, and multi-step arithmetic.
- As soon as you know what needs computing, call the tool. Do not work it out first and do not "estimate" it. Examples: data set given -> call statistics with the data right away; system of equations -> call algebra solve with the equations; normal-distribution probability -> call calculate with normalcdf(...).
- Call all independent tools in the same turn instead of one at a time.
- Trust the tool results; do not re-check them by hand. Then match the result to an answer option and answer.
- Do not mention the tools in your answer.
""".strip()


# ---------------------------------------------------------------------------- SymPy (lazy)

_sympy_lock = threading.Lock()
_ns: dict | None = None  # namespace for parse_expr
_transforms = None


def _namespace() -> dict:
    global _ns, _transforms
    with _sympy_lock:
        if _ns is not None:
            return _ns
        import mpmath
        import sympy as sp
        from sympy.parsing.sympy_parser import (convert_xor, implicit_multiplication_application,
                                                standard_transformations)

        deg = sp.pi / 180

        def num(x) -> float:
            return float(sp.N(x))

        def normalcdf(lower, upper, mean=0, sd=1):
            from statistics import NormalDist
            d = NormalDist(num(mean), num(sd))
            return sp.Float(d.cdf(num(upper)) - d.cdf(num(lower)))

        def normalpdf(x, mean=0, sd=1):
            from statistics import NormalDist
            return sp.Float(NormalDist(num(mean), num(sd)).pdf(num(x)))

        def invnorm(area, mean=0, sd=1):
            from statistics import NormalDist
            return sp.Float(NormalDist(num(mean), num(sd)).inv_cdf(num(area)))

        def binompdf(n, p, k):
            n, k, p = int(n), int(k), sp.nsimplify(p)
            return sp.binomial(n, k) * p**k * (1 - p)**(n - k) if 0 <= k <= n else sp.Integer(0)

        def binomcdf(n, p, k):
            return sum((binompdf(n, p, i) for i in range(0, min(int(k), int(n)) + 1)), sp.Integer(0))

        def poissonpdf(mean, k):
            mean, k = sp.nsimplify(mean), int(k)
            return sp.exp(-mean) * mean**k / sp.factorial(k) if k >= 0 else sp.Integer(0)

        def poissoncdf(mean, k):
            return sum((poissonpdf(mean, i) for i in range(0, int(k) + 1)), sp.Integer(0))

        def geometpdf(p, k):
            p = sp.nsimplify(p)
            return (1 - p)**(int(k) - 1) * p

        def geometcdf(p, k):
            return 1 - (1 - sp.nsimplify(p))**int(k)

        def _t_cdf(t: float, df: float) -> float:
            if math.isinf(t) or abs(t) > 1e50:
                return 1.0 if t > 0 else 0.0
            x = df / (df + t * t)
            tail = 0.5 * float(mpmath.betainc(df / 2, 0.5, 0, x, regularized=True))
            return 1 - tail if t > 0 else tail

        def tcdf(lower, upper, df):
            df = num(df)
            return sp.Float(_t_cdf(num(upper), df) - _t_cdf(num(lower), df))

        def invt(area, df):
            area, df = num(area), num(df)
            lo, hi = -1e3, 1e3
            for _ in range(200):
                mid = (lo + hi) / 2
                if _t_cdf(mid, df) < area:
                    lo = mid
                else:
                    hi = mid
            return sp.Float((lo + hi) / 2)

        def chi2cdf(lower, upper, df):
            k = num(df)

            def cdf(x: float) -> float:
                if x <= 0:
                    return 0.0
                if x > 1e50:
                    return 1.0
                return float(mpmath.gammainc(k / 2, 0, x / 2, regularized=True))

            return sp.Float(cdf(num(upper)) - cdf(num(lower)))

        def matrix(m):
            return m if isinstance(m, sp.MatrixBase) else sp.Matrix(m)

        def rnd(x, digits=0):
            return sp.Float(round(num(x), int(digits))) if int(digits) else sp.Integer(round(num(x)))

        ns: dict[str, Any] = {
            "__builtins__": {},
            # what parse_expr's transformations emit
            "Integer": sp.Integer, "Float": sp.Float, "Rational": sp.Rational, "Symbol": sp.Symbol,
            "Function": sp.Function, "factorial": sp.factorial,
            # constants
            "pi": sp.pi, "e": sp.E, "E": sp.E, "oo": sp.oo, "inf": sp.oo, "infinity": sp.oo, "I": sp.I,
            # functions
            "sqrt": sp.sqrt, "root": sp.root, "cbrt": sp.cbrt, "abs": sp.Abs, "Abs": sp.Abs, "exp": sp.exp,
            "ln": sp.log, "log": lambda x, b=10: sp.log(x, b), "log10": lambda x: sp.log(x, 10),
            "log2": lambda x: sp.log(x, 2),
            "sin": sp.sin, "cos": sp.cos, "tan": sp.tan, "sec": sp.sec, "csc": sp.csc, "cot": sp.cot,
            "asin": sp.asin, "acos": sp.acos, "atan": sp.atan, "atan2": sp.atan2,
            "arcsin": sp.asin, "arccos": sp.acos, "arctan": sp.atan,
            "sinh": sp.sinh, "cosh": sp.cosh, "tanh": sp.tanh,
            "sind": lambda x: sp.sin(x * deg), "cosd": lambda x: sp.cos(x * deg), "tand": lambda x: sp.tan(x * deg),
            "asind": lambda x: sp.asin(x) / deg, "acosd": lambda x: sp.acos(x) / deg,
            "atand": lambda x: sp.atan(x) / deg,
            "floor": sp.floor, "ceiling": sp.ceiling, "ceil": sp.ceiling, "round": rnd,
            "gcd": sp.gcd, "lcm": sp.lcm, "mod": sp.Mod, "max": sp.Max, "min": sp.Min,
            "nCr": sp.binomial, "ncr": sp.binomial, "binomial": sp.binomial, "comb": sp.binomial,
            "nPr": lambda n, r: sp.factorial(n) / sp.factorial(n - r),
            "npr": lambda n, r: sp.factorial(n) / sp.factorial(n - r),
            "det": lambda m: matrix(m).det(), "inv": lambda m: matrix(m).inv(),
            "inverse": lambda m: matrix(m).inv(), "rref": lambda m: matrix(m).rref()[0],
            "transpose": lambda m: matrix(m).T, "matmul": lambda a, b: matrix(a) * matrix(b),
            "Matrix": matrix,
            "normalcdf": normalcdf, "normalpdf": normalpdf, "invnorm": invnorm, "invNorm": invnorm,
            "binompdf": binompdf, "binomcdf": binomcdf, "poissonpdf": poissonpdf, "poissoncdf": poissoncdf,
            "geometpdf": geometpdf, "geometcdf": geometcdf, "tcdf": tcdf, "invt": invt, "invT": invt,
            "chi2cdf": chi2cdf,
        }
        _transforms = standard_transformations + (implicit_multiplication_application, convert_xor)
        _ns = ns
        return ns


# ---------------------------------------------------------------------------- parsing

SAFE_CHARS_RE = re.compile(r"^[0-9A-Za-z_+\-*/^().,\s=<>!\[\]]*$")
ATTRIBUTE_RE = re.compile(r"\.\s*[A-Za-z_]")


def _clean(src: str) -> str:
    src = (str(src).replace("×", "*").replace("·", "*").replace("÷", "/").replace("−", "-")
           .replace("π", "pi").replace("√", "sqrt").replace("≤", "<=").replace("≥", ">=").replace("∞", "oo"))
    if len(src) > MAX_EXPRESSION_LEN:
        raise ValueError("expression too long")
    if not SAFE_CHARS_RE.match(src) or "__" in src or ATTRIBUTE_RE.search(src):
        raise ValueError(f"unsupported characters or syntax in {src!r}")
    return src


def parse(src: str):
    from sympy.parsing.sympy_parser import parse_expr
    ns = _namespace()
    return parse_expr(_clean(src), global_dict=dict(ns), transformations=_transforms)


EQUALS_RE = re.compile(r"(?<![<>!=])=(?!=)")


def _parse_relation(src: str):
    """'a = b' -> Eq(a, b); inequalities parse to relationals; a plain expression means expr = 0."""
    import sympy as sp
    parts = EQUALS_RE.split(src)
    if len(parts) == 2:
        return sp.Eq(parse(parts[0]), parse(parts[1]))
    if len(parts) > 2:
        raise ValueError(f"more than one '=' in {src!r}")
    return parse(src)


# ---------------------------------------------------------------------------- formatting

def _decimal(value) -> str | None:
    import sympy as sp
    try:
        n = sp.N(value, 12)
    except Exception:  # noqa: BLE001
        return None
    if not getattr(n, "is_number", False):
        return None
    if n.is_real:
        f = float(n)
        return str(int(f)) if f.is_integer() and abs(f) < 1e15 else f"{f:.10g}"
    return str(sp.N(value, 10))


def _value(value) -> dict:
    """{"exact": ..., "decimal": ...} for a SymPy result (matrices and lists included)."""
    import sympy as sp
    if isinstance(value, sp.MatrixBase):
        return {"matrix": [[_decimal(x) or sp.sstr(x) for x in row] for row in value.tolist()],
                "exact": sp.sstr(value.tolist())}
    if isinstance(value, (list, tuple)):
        return {"values": [_value(v) for v in value]}
    exact = sp.sstr(value)
    out = {"exact": exact}
    dec = _decimal(value)
    if dec is not None and dec != exact:
        out["decimal"] = dec
    return out


def _r(x: float) -> float | int:
    """Round to 10 significant figures for display/JSON."""
    if isinstance(x, int) or (isinstance(x, float) and x.is_integer() and abs(x) < 1e15):
        return int(x)
    return float(f"{x:.10g}")


# ---------------------------------------------------------------------------- tools

def _calculate(args: dict) -> dict:
    exprs = args.get("expressions")
    if isinstance(exprs, str):
        exprs = [exprs]
    if not exprs and args.get("expression"):
        exprs = [args["expression"]]
    if not exprs:
        raise ValueError("no expressions given")
    results = []
    for src in exprs[:20]:
        try:
            results.append({"expression": src, **_value(parse(src))})
        except Exception as exc:  # noqa: BLE001 - reported back to the model so it can fix the call
            results.append({"expression": src, "error": f"{type(exc).__name__}: {exc}"})
    return {"results": results}


def _symbols(args: dict, exprs: list) -> list:
    import sympy as sp
    names = args.get("variables") or []
    if isinstance(names, str):
        names = [names]
    if names:
        return [parse(n) for n in names]
    free: set = set()
    for e in exprs:
        free |= getattr(e, "free_symbols", set())
    return sorted(free, key=lambda s: s.name)


def _algebra(args: dict) -> dict:
    import sympy as sp
    op = str(args.get("operation", "")).lower()
    srcs = args.get("expressions") or []
    if isinstance(srcs, str):
        srcs = [srcs]
    if not srcs:
        raise ValueError("no expressions given")

    if op == "solve":
        rels = [_parse_relation(s) for s in srcs]
        variables = _symbols(args, rels)
        inequalities = [r for r in rels if isinstance(r, sp.Rel) and not isinstance(r, sp.Eq)]
        if inequalities:
            if len(variables) != 1:
                raise ValueError("inequalities need exactly one variable")
            result = sp.reduce_inequalities(inequalities, variables[0])
            return {"solution": sp.sstr(result)}
        solutions = sp.solve(rels, variables, dict=True)
        if not solutions:
            return {"solutions": [], "note": "no solution found"}
        return {"solutions": [{sp.sstr(k): _value(v) for k, v in sol.items()} for sol in solutions[:20]]}

    expr = parse(srcs[0])
    variables = _symbols(args, [expr])
    var = variables[0] if variables else sp.Symbol("x")
    if op == "simplify":
        return _value(sp.simplify(expr))
    if op == "factor":
        return _value(sp.factor(expr))
    if op == "expand":
        return _value(sp.expand(expr))
    if op == "derivative":
        return _value(sp.diff(expr, var, int(args.get("order") or 1)))
    if op == "integral":
        lower, upper = args.get("lower"), args.get("upper")
        if lower not in (None, "") and upper not in (None, ""):
            result = sp.integrate(expr, (var, parse(str(lower)), parse(str(upper))))
            if isinstance(result, sp.Integral):  # no closed form: integrate numerically
                result = sp.N(result)
            return _value(result)
        return {**_value(sp.integrate(expr, var)), "note": "+ C"}
    if op == "limit":
        point = args.get("point")
        if point in (None, ""):
            raise ValueError("limit needs a point")
        return _value(sp.limit(expr, var, parse(str(point)), args.get("direction") or "+-"))
    raise ValueError(f"unknown operation {op!r}")


def _quartiles(xs: list[float]) -> tuple[float, float]:
    """TI-84 method: medians of the lower and upper halves, excluding the median when n is odd."""
    n = len(xs)
    if n < 2:
        return xs[0], xs[0]
    return st.median(xs[: n // 2]), st.median(xs[(n + 1) // 2:])


def _one_var(xs: list[float]) -> dict:
    xs = sorted(xs)
    n = len(xs)
    q1, q3 = _quartiles(xs)
    modes = st.multimode(xs)
    out = {
        "n": n, "sum": _r(math.fsum(xs)), "sum_of_squares": _r(math.fsum(x * x for x in xs)),
        "mean": _r(st.fmean(xs)), "median": _r(st.median(xs)),
        "mode": "none (all values occur equally often)" if len(modes) == len(set(xs)) and n > 1 else [_r(m) for m in modes],
        "population_sd": _r(st.pstdev(xs)), "population_variance": _r(st.pvariance(xs)),
        "min": _r(xs[0]), "q1": _r(q1), "q3": _r(q3), "max": _r(xs[-1]),
        "range": _r(xs[-1] - xs[0]), "iqr": _r(q3 - q1),
    }
    if n > 1:
        out["sample_sd"] = _r(st.stdev(xs))
        out["sample_variance"] = _r(st.variance(xs))
    return out


def _regression(xs: list[float], ys: list[float], kind: str) -> dict:
    import numpy as np
    x, y = np.asarray(xs, float), np.asarray(ys, float)

    def r_of(a, b) -> float:
        return float(np.corrcoef(a, b)[0, 1])

    if kind == "linear":
        b, a = np.polyfit(x, y, 1)
        r = r_of(x, y)
        return {"equation": f"y = {_r(a)} + {_r(b)}x", "a": _r(a), "b": _r(b), "r": _r(r), "r_squared": _r(r * r)}
    if kind in ("quadratic", "cubic"):
        deg = 2 if kind == "quadratic" else 3
        coefs = np.polyfit(x, y, deg)
        pred = np.polyval(coefs, x)
        ss_res, ss_tot = float(((y - pred) ** 2).sum()), float(((y - y.mean()) ** 2).sum())
        names = "abcd"[: deg + 1]
        terms = " + ".join(f"{n}x^{deg - i}" if deg - i > 1 else (f"{n}x" if deg - i == 1 else n)
                           for i, n in enumerate(names))
        return {"equation": f"y = {terms}", **{n: _r(c) for n, c in zip(names, coefs)},
                "r_squared": _r(1 - ss_res / ss_tot if ss_tot else 1.0)}
    if kind == "exponential":  # y = a·b^x, fitted on ln y like a TI-84
        if (y <= 0).any():
            raise ValueError("exponential regression needs all y > 0")
        lb, la = np.polyfit(x, np.log(y), 1)
        r = r_of(x, np.log(y))
        a, b = math.exp(la), math.exp(lb)
        return {"equation": f"y = {_r(a)}·{_r(b)}^x", "a": _r(a), "b": _r(b), "r": _r(r), "r_squared": _r(r * r)}
    if kind == "power":  # y = a·x^b
        if (y <= 0).any() or (x <= 0).any():
            raise ValueError("power regression needs all x > 0 and y > 0")
        b, la = np.polyfit(np.log(x), np.log(y), 1)
        r = r_of(np.log(x), np.log(y))
        a = math.exp(la)
        return {"equation": f"y = {_r(a)}·x^{_r(b)}", "a": _r(a), "b": _r(b), "r": _r(r), "r_squared": _r(r * r)}
    if kind == "logarithmic":  # y = a + b·ln x
        if (x <= 0).any():
            raise ValueError("logarithmic regression needs all x > 0")
        b, a = np.polyfit(np.log(x), y, 1)
        r = r_of(np.log(x), y)
        return {"equation": f"y = {_r(a)} + {_r(b)}·ln(x)", "a": _r(a), "b": _r(b), "r": _r(r), "r_squared": _r(r * r)}
    raise ValueError(f"unknown regression {kind!r}")


def _statistics(args: dict) -> dict:
    data = [float(v) for v in args.get("data") or []]
    if not data:
        raise ValueError("no data given")
    freqs = args.get("frequencies")
    ys = args.get("y")
    if ys:
        ys = [float(v) for v in ys]
        if len(ys) != len(data):
            raise ValueError(f"data has {len(data)} values but y has {len(ys)}")
        kind = str(args.get("regression") or "linear").lower()
        return {"x": _one_var(data), "y": _one_var(ys), "regression": {"type": kind, **_regression(data, ys, kind)}}
    if freqs:
        if len(freqs) != len(data):
            raise ValueError(f"data has {len(data)} values but frequencies has {len(freqs)}")
        expanded = []
        for value, f in zip(data, freqs):
            if f < 0 or float(f) != int(f):
                raise ValueError("frequencies must be whole numbers >= 0")
            expanded += [value] * int(f)
        if len(expanded) > 1_000_000:
            raise ValueError("too many values")
        data = expanded
    return _one_var(data)


_HANDLERS = {"calculate": _calculate, "algebra": _algebra, "statistics": _statistics}


# ---------------------------------------------------------------------------- labels for the HUD

def _short(text: str, limit: int = 60) -> str:
    text = " ".join(str(text).split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def describe(name: str, args: dict) -> str:
    """One-line label of a call, e.g. 'statistics · 12 values'."""
    try:
        if name == "calculate":
            exprs = args.get("expressions") or [args.get("expression", "")]
            return f"calculate · {_short(', '.join(map(str, exprs)))}"
        if name == "algebra":
            return f"{args.get('operation', 'algebra')} · {_short('; '.join(map(str, args.get('expressions') or [])))}"
        if name == "statistics":
            label = f"statistics · {len(args.get('data') or [])} values"
            if args.get("y"):
                label += f", {args.get('regression') or 'linear'} regression"
            return label
    except Exception:  # noqa: BLE001
        pass
    return name


def summarize(name: str, result: dict) -> str:
    """A short result for the HUD row."""
    try:
        if "error" in result:
            return _short(result["error"], 50)
        if name == "calculate":
            parts = [r.get("error") and "error" or r.get("decimal") or r.get("exact") or "…" for r in result["results"]]
            return _short("= " + ", ".join(parts), 50)
        if name == "statistics":
            if "regression" in result:
                reg = result["regression"]
                return _short(f"{reg['equation']}, r² = {reg['r_squared']}", 50)
            sx = result.get("sample_sd")
            return _short(f"x̄ = {result['mean']}" + (f", Sx = {sx}" if sx is not None else "")
                          + f", σx = {result['population_sd']}", 50)
        if name == "algebra":
            if "solutions" in result:
                sols = ["; ".join(f"{k} = {v.get('exact')}" for k, v in s.items()) for s in result["solutions"]]
                return _short(" | ".join(sols) or "no solution", 50)
            return _short("= " + str(result.get("solution") or result.get("exact")), 50)
    except Exception:  # noqa: BLE001
        pass
    return "done"


# ---------------------------------------------------------------------------- entry point

def _execute(name: str, args: dict) -> dict:
    try:
        return _HANDLERS[name](args)
    except Exception as exc:  # noqa: BLE001 - reported back to the model so it can fix the call
        return {"error": f"{type(exc).__name__}: {exc}"}


def _serve(conn) -> None:
    """Child process: imports SymPy up front, then answers (name, args) requests until the pipe closes."""
    try:
        _namespace()
    except Exception:  # noqa: BLE001 - reported per call instead
        pass
    while True:
        try:
            name, args = conn.recv()
        except (EOFError, OSError):
            return
        result = _execute(name, args)
        try:
            conn.send(json.loads(json.dumps(result, default=str)))  # plain JSON types only
        except (OSError, ValueError):
            return


class _ToolProcess:
    """Tools run in a separate process: big-integer math holds the GIL (9^9^9^9 would freeze the UI
    thread too), and a process can be killed when a calculation runs away."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._proc = None
        self._conn = None

    def _ensure(self) -> None:
        if self._proc is not None and self._proc.is_alive():
            return
        import multiprocessing as mp
        ctx = mp.get_context("spawn")
        parent, child = ctx.Pipe()
        self._proc = ctx.Process(target=_serve, args=(child,), name="ugh-tools", daemon=True)
        self._proc.start()
        child.close()
        self._conn = parent

    def start(self) -> None:
        with self._lock:
            self._ensure()

    def stop(self) -> None:
        with self._lock:
            self._kill()

    def _kill(self) -> None:
        if self._proc is not None:
            try:
                self._proc.kill()
            except Exception:  # noqa: BLE001
                pass
        if self._conn is not None:
            self._conn.close()
        self._proc = self._conn = None

    def call(self, name: str, args: dict, timeout: float) -> dict:
        with self._lock:
            self._ensure()
            try:
                self._conn.send((name, args))
                # The first call may also wait for SymPy's import in the child.
                if self._conn.poll(timeout + 15 if not getattr(self, "_warm", False) else timeout):
                    self._warm = True
                    return self._conn.recv()
            except (EOFError, OSError) as exc:
                self._kill()
                return {"error": f"calculator process failed ({exc}); try again"}
            self._kill()  # runaway calculation: kill it, the next call starts a fresh process
            return {"error": f"timed out after {timeout:g}s; simplify the request"}


_process = _ToolProcess()


def prewarm() -> None:
    """Starts the calculator process (and its SymPy import) in the background."""
    threading.Thread(target=_process.start, name="ugh-tools-start", daemon=True).start()


def shutdown() -> None:
    _process.stop()


def run(name: str, raw_args: str) -> tuple[dict, str, bool]:
    """Runs a tool call. Returns (result for the model, short summary for the HUD, ok)."""
    try:
        args = json.loads(raw_args or "{}")
        if not isinstance(args, dict):
            raise ValueError("arguments must be a JSON object")
    except ValueError as exc:
        result = {"error": f"invalid JSON arguments: {exc}"}
        return result, summarize(name, result), False
    if name not in _HANDLERS:
        result = {"error": f"unknown tool {name!r}; available: {', '.join(_HANDLERS)}"}
        return result, summarize(name, result), False
    result = _process.call(name, args, TOOL_TIMEOUT_S)
    return result, summarize(name, result), "error" not in result
