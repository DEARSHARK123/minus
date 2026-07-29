/**
 * Extract and parse JSON object/array from LLM text (fenced or raw).
 */

export function parseJsonFromLLM<T>(raw: string): T {
  const text = raw.trim();
  if (!text) {
    throw new Error('Empty LLM response');
  }

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fence?.[1] ?? text).trim();

  try {
    return JSON.parse(candidate) as T;
  } catch {
    const objStart = candidate.indexOf('{');
    const objEnd = candidate.lastIndexOf('}');
    if (objStart >= 0 && objEnd > objStart) {
      return JSON.parse(candidate.slice(objStart, objEnd + 1)) as T;
    }
    const arrStart = candidate.indexOf('[');
    const arrEnd = candidate.lastIndexOf(']');
    if (arrStart >= 0 && arrEnd > arrStart) {
      return JSON.parse(candidate.slice(arrStart, arrEnd + 1)) as T;
    }
    throw new Error('Failed to parse JSON from LLM response');
  }
}
