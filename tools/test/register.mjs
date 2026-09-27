// Lets Node resolve extensionless relative imports ('./ObstacleGrid') to '.ts' files the way the
// Cocos compiler does, so pure game modules (no 'cc' imports) run under Node's type stripping.
//
//   node --import ./tools/test/register.mjs --test "tools/test/*.test.mjs"

import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      const relative = specifier.startsWith('./') || specifier.startsWith('../');
      if (err?.code !== 'ERR_MODULE_NOT_FOUND' || !relative) throw err;
      return next(`${specifier}.ts`, context);
    }
  },
});
