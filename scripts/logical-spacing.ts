import type { RuleTester } from "oxlint/plugins-dev";

type Rule = Parameters<RuleTester["run"]>[1];

type Create = Extract<Rule, { create: unknown }>["create"];

type Context = Parameters<Create>[0];

type Node = Parameters<NonNullable<ReturnType<Create>[string]>>[0];

const declarationTypes = new Set([
  "FunctionDeclaration",
  "TSDeclareFunction",
  "ClassDeclaration",
  "TSTypeAliasDeclaration",
  "TSInterfaceDeclaration",
  "TSEnumDeclaration",
  "TSModuleDeclaration",
  "MethodDefinition",
  "TSAbstractMethodDefinition",
]);

const testNames = new Set([
  "test",
  "it",
  "describe",
  "suite",
  "beforeEach",
  "afterEach",
  "beforeAll",
  "afterAll",
]);

const rule: Rule = {
  meta: {
    type: "layout",
    fixable: "whitespace",
    schema: [],
    messages: {
      separate:
        "Add a blank line around declarations, methods, tests, suites, and hooks.",
    },
  },
  create(context) {
    const testCalls = new Set(testNames);

    function check(nodes: readonly Node[]): void {
      for (let index = 1; index < nodes.length; index++) {
        const previous = nodes[index - 1];
        const current = nodes[index];
        if (previous === undefined || current === undefined) continue;
        if (
          !requiresSeparation(previous, testCalls) &&
          !requiresSeparation(current, testCalls)
        )
          continue;

        const { position, whitespace } = boundaryGap(
          context,
          previous,
          current,
        );

        if (/\r?\n[\t ]*\r?\n/u.test(whitespace)) continue;

        reportBoundary(context, current, position);
      }
    }

    return {
      Program(node) {
        for (const statement of node.body) {
          registerTestImports(statement, testCalls);
        }

        check(node.body);
      },
      BlockStatement(node) {
        check(node.body);
      },
      SwitchCase(node) {
        check(node.consequent);
      },
      ClassBody(node) {
        check(node.body);
      },
      StaticBlock(node) {
        check(node.body);
      },
      TSModuleBlock(node) {
        check(node.body);
      },
    };
  },
};

function boundaryGap(
  context: Context,
  previous: Node,
  current: Node,
): { position: number; whitespace: string } {
  const source = context.sourceCode;
  const comments = source.getCommentsBefore(current);
  const leading = comments.find(
    (comment: {
      readonly loc: { readonly start: { readonly line: number } };
    }) => comment.loc.start.line > previous.loc.end.line,
  );
  const position = leading?.range[0] ?? current.range[0];
  let whitespace = "";
  let cursor = previous.range[1];

  // Comment contents cannot provide separation. Keep leading comments
  // attached to their statement and trailing comments on their own block.
  for (const comment of comments) {
    if (comment.range[0] < cursor || comment.range[0] >= position) continue;

    whitespace += source.text.slice(cursor, comment.range[0]);
    cursor = comment.range[1];
  }

  whitespace += source.text.slice(cursor, position);

  return { position, whitespace };
}

function reportBoundary(context: Context, node: Node, position: number): void {
  const source = context.sourceCode.text;
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const lineStart = source.lastIndexOf("\n", position - 1) + 1;
  const ownLine = /^[\t ]*$/u.test(source.slice(lineStart, position));
  const insertion = ownLine ? lineStart : position;

  context.report({
    node,
    messageId: "separate",
    fix(fixer) {
      return fixer.insertTextBeforeRange(
        [insertion, insertion],
        ownLine ? newline : newline + newline,
      );
    },
  });
}

function registerTestImports(node: Node, testCalls: Set<string>): void {
  if (node.type !== "ImportDeclaration") return;

  for (const specifier of node.specifiers) {
    if (
      specifier.type !== "ImportSpecifier" ||
      specifier.imported.type !== "Identifier"
    )
      continue;

    if (testNames.has(specifier.imported.name)) {
      testCalls.add(specifier.local.name);
    }
  }
}

function requiresSeparation(
  node: Node,
  testCalls: Readonly<ReadonlySet<string>>,
): boolean {
  if (node.type === "ExportNamedDeclaration" && node.declaration !== null) {
    return requiresSeparation(node.declaration, testCalls);
  }

  if (node.type === "ExportDefaultDeclaration") {
    return requiresSeparation(node.declaration, testCalls);
  }

  if (declarationTypes.has(node.type) || isFunction(node)) return true;

  if (node.type === "VariableDeclaration") {
    return node.declarations.some(
      (declaration: { readonly init: Readonly<Pick<Node, "type">> | null }) =>
        isFunction(declaration.init),
    );
  }

  if (node.type === "PropertyDefinition") return isFunction(node.value);

  const root = callRoot(node);

  return root !== undefined && testCalls.has(root);
}

function isFunction(
  node: Readonly<Pick<Node, "type">> | null | undefined,
): boolean {
  return (
    node?.type === "ArrowFunctionExpression" ||
    node?.type === "FunctionExpression"
  );
}

function callRoot(node: Node): string | undefined {
  if (node.type !== "ExpressionStatement") return undefined;

  let expression = node.expression;

  if (expression.type !== "CallExpression") return undefined;

  while (
    expression.type === "CallExpression" ||
    expression.type === "MemberExpression"
  ) {
    expression =
      expression.type === "CallExpression"
        ? expression.callee
        : expression.object;
  }

  return expression.type === "Identifier" ? expression.name : undefined;
}

export default {
  meta: { name: "readable" },
  rules: { "logical-spacing": rule },
};
