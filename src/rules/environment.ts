// The environment (환경): an open-ended map of type -> value.
//
// Rule: the same TYPE cannot stack — developing a new value for a type that is
// already present replaces it. Different types coexist freely. Types are not a
// fixed set; any string is a valid type.
//
//   [지역:사천, 지형:산, 장소:묘지]            ✔ different types
//   [날씨:눈] then develop 날씨:비 → [날씨:비]  (same type replaced, never both)

import type { EnvDevelop, Environment, EnvType } from './types.js';

export function emptyEnvironment(): Environment {
  return {};
}

// Develop one environment entry, returning a NEW environment. Same-type replaces.
export function develop(env: Environment, type: EnvType, value: string): Environment {
  return { ...env, [type]: value };
}

export function developAll(env: Environment, develops: readonly EnvDevelop[]): Environment {
  let out = env;
  for (const d of develops) out = develop(out, d.type, d.value);
  return out;
}

export function hasEnv(env: Environment, type: EnvType, value: string): boolean {
  return env[type] === value;
}

export function hasType(env: Environment, type: EnvType): boolean {
  return type in env;
}

export function environmentTypes(env: Environment): EnvType[] {
  return Object.keys(env);
}
