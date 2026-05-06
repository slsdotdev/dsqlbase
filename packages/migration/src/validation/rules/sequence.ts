import { AnySequenceDefinition } from "@dsqlbase/core/definition";
import { Rule } from "../context.js";

const MIN_DSQL_CACHE = 65536;

export const invalidSequenceCache: Rule<AnySequenceDefinition> = (sequence, context) => {
  const cache = sequence.options.cache;
  if (cache === undefined || cache === 1 || cache >= MIN_DSQL_CACHE) return;

  context.report({
    level: "error",
    code: "INVALID_SEQUENCE_CACHE",
    message: `Sequence "${sequence.name}" has cache=${cache}; DSQL requires cache=1 or cache >= ${MIN_DSQL_CACHE}.`,
    path: [sequence.namespace, sequence.name],
  });
};
