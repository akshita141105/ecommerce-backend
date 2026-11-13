// utils/slug.ts
// slugify's .d.ts merges a callable function with a namespace in a way that
// doesn't survive NodeNext + esModuleInterop module resolution cleanly (the
// call signature gets dropped by the type checker) — cast through the real
// signature once here instead of repeating the workaround at every call site.
import slugifyPkg from "slugify";

type SlugifyOptions = {
  replacement?: string;
  remove?: RegExp;
  lower?: boolean;
  strict?: boolean;
  locale?: string;
  trim?: boolean;
};

type SlugifyFn = (str: string, options?: SlugifyOptions | string) => string;

const slugify = slugifyPkg as unknown as SlugifyFn;

export default slugify;
