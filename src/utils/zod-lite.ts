export type ZodIssue = {
  path: (string | number)[];
  message: string;
};

export class ZodError extends Error {
  constructor(public readonly issues: ZodIssue[]) {
    super(issues.length ? issues[0].message : 'Invalid data');
    this.name = 'ZodError';
  }
}

export abstract class ZodType<T> {
  optional(): ZodType<T | undefined> {
    return new ZodOptional(this);
  }

  nullable(): ZodType<T | null> {
    return new ZodNullable(this);
  }

  array(): ZodArray<T> {
    return new ZodArray(this);
  }

  default(value: T): ZodType<T> {
    return new ZodDefault(this, value);
  }

  parse(value: unknown): T {
    const result = this.safeParse(value);
    if (!result.success) {
      throw new ZodError(result.error);
    }
    return result.data;
  }

  safeParse(value: unknown): { success: true; data: T } | { success: false; error: ZodIssue[] } {
    try {
      return { success: true, data: this._parse(value, []) };
    } catch (err) {
      if (err instanceof ZodError) {
        return { success: false, error: err.issues };
      }
      throw err;
    }
  }

  protected abstract _parse(value: unknown, path: (string | number)[]): T;
}

class ZodString extends ZodType<string> {
  constructor(private readonly checks: ((value: string, path: (string | number)[]) => void)[] = []) {
    super();
  }

  min(length: number, message = `Expected string of length at least ${length}`): ZodString {
    return new ZodString([...this.checks, (value, path) => {
      if (value.length < length) {
        throw new ZodError([{ path, message }]);
      }
    }]);
  }

  protected _parse(value: unknown, path: (string | number)[]): string {
    if (typeof value !== 'string') {
      throw new ZodError([{ path, message: 'Expected string' }]);
    }
    for (const check of this.checks) {
      check(value, path);
    }
    return value;
  }
}

class ZodNumber extends ZodType<number> {
  constructor(private readonly checks: ((value: number, path: (string | number)[]) => void)[] = []) {
    super();
  }

  nonnegative(message = 'Expected non-negative number'): ZodNumber {
    return new ZodNumber([...this.checks, (value, path) => {
      if (value < 0) {
        throw new ZodError([{ path, message }]);
      }
    }]);
  }

  protected _parse(value: unknown, path: (string | number)[]): number {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      throw new ZodError([{ path, message: 'Expected number' }]);
    }
    for (const check of this.checks) {
      check(value, path);
    }
    return value;
  }
}

class ZodBoolean extends ZodType<boolean> {
  protected _parse(value: unknown, path: (string | number)[]): boolean {
    if (typeof value !== 'boolean') {
      throw new ZodError([{ path, message: 'Expected boolean' }]);
    }
    return value;
  }
}

class ZodLiteral<T> extends ZodType<T> {
  constructor(private readonly literalValue: T) {
    super();
  }

  protected _parse(value: unknown, path: (string | number)[]): T {
    if (value !== this.literalValue) {
      throw new ZodError([{ path, message: `Expected literal ${JSON.stringify(this.literalValue)}` }]);
    }
    return value as T;
  }
}

class ZodEnum<T extends string> extends ZodType<T> {
  constructor(private readonly values: readonly T[]) {
    super();
  }

  protected _parse(value: unknown, path: (string | number)[]): T {
    if (typeof value !== 'string' || !this.values.includes(value as T)) {
      throw new ZodError([{ path, message: `Expected one of ${this.values.join(', ')}` }]);
    }
    return value as T;
  }
}

class ZodArray<T> extends ZodType<T[]> {
  constructor(private readonly element: ZodType<T>) {
    super();
  }

  protected _parse(value: unknown, path: (string | number)[]): T[] {
    if (!Array.isArray(value)) {
      throw new ZodError([{ path, message: 'Expected array' }]);
    }
    return value.map((item, index) => this.element._parse(item, [...path, index]));
  }
}

class ZodOptional<T> extends ZodType<T | undefined> {
  constructor(private readonly inner: ZodType<T>) {
    super();
  }

  protected _parse(value: unknown, path: (string | number)[]): T | undefined {
    if (value === undefined) {
      return undefined;
    }
    return this.inner._parse(value, path);
  }
}

class ZodNullable<T> extends ZodType<T | null> {
  constructor(private readonly inner: ZodType<T>) {
    super();
  }

  protected _parse(value: unknown, path: (string | number)[]): T | null {
    if (value === null) {
      return null;
    }
    return this.inner._parse(value, path);
  }
}

class ZodDefault<T> extends ZodType<T> {
  constructor(private readonly inner: ZodType<T>, private readonly defaultValue: T) {
    super();
  }

  protected _parse(value: unknown, path: (string | number)[]): T {
    if (value === undefined) {
      return this.defaultValue;
    }
    return this.inner._parse(value, path);
  }
}

class ZodRecord<T> extends ZodType<Record<string, T>> {
  constructor(private readonly value: ZodType<T>) {
    super();
  }

  protected _parse(value: unknown, path: (string | number)[]): Record<string, T> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new ZodError([{ path, message: 'Expected object record' }]);
    }
    const result: Record<string, T> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = this.value._parse(val, [...path, key]);
    }
    return result;
  }
}

class ZodAny extends ZodType<any> {
  protected _parse(value: unknown, _path: (string | number)[]): any {
    return value;
  }
}

type ZodShape = Record<string, ZodType<any>>;

type InferredShape<S extends ZodShape> = {
  [K in keyof S]: S[K] extends ZodType<infer U> ? U : never;
};

class ZodObject<S extends ZodShape> extends ZodType<InferredShape<S>> {
  constructor(private readonly shape: S) {
    super();
  }

  protected _parse(value: unknown, path: (string | number)[]): InferredShape<S> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new ZodError([{ path, message: 'Expected object' }]);
    }
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(this.shape)) {
      const schema = this.shape[key];
      const childPath = [...path, key];
      const inputValue = (value as Record<string, unknown>)[key];
      result[key] = schema._parse(inputValue, childPath);
    }
    return result as InferredShape<S>;
  }

  merge<OtherShape extends ZodShape>(other: ZodObject<OtherShape>): ZodObject<S & OtherShape> {
    return new ZodObject({ ...(this.shape as any), ...(other.shape as any) });
  }
}

class ZodUnion<T> extends ZodType<T> {
  constructor(private readonly options: ZodType<any>[]) {
    super();
  }

  protected _parse(value: unknown, path: (string | number)[]): T {
    const errors: ZodIssue[][] = [];
    for (const option of this.options) {
      const result = option.safeParse(value);
      if (result.success) {
        return result.data as T;
      }
      errors.push(result.error);
    }
    throw new ZodError(errors.flat());
  }
}

export const z = {
  string(): ZodString {
    return new ZodString();
  },
  number(): ZodNumber {
    return new ZodNumber();
  },
  boolean(): ZodBoolean {
    return new ZodBoolean();
  },
  literal<T extends string | number | boolean>(value: T): ZodLiteral<T> {
    return new ZodLiteral(value);
  },
  enum<T extends string>(values: readonly [T, ...T[]]): ZodEnum<T> {
    return new ZodEnum(values);
  },
  object<S extends ZodShape>(shape: S): ZodObject<S> {
    return new ZodObject(shape);
  },
  array<T>(schema: ZodType<T>): ZodArray<T> {
    return new ZodArray(schema);
  },
  union<T extends [ZodType<any>, ZodType<any>, ...ZodType<any>[]]>(schemas: T): ZodUnion<
    T[number] extends ZodType<infer U> ? U : never
  > {
    return new ZodUnion(schemas);
  },
  record<T>(schema: ZodType<T>): ZodRecord<T> {
    return new ZodRecord(schema);
  },
  any(): ZodAny {
    return new ZodAny();
  },
};

export type infer<T extends ZodType<any>> = T extends ZodType<infer U> ? U : never;
