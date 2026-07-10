/** Text sizing and search helpers shared by workspace operations. */

/** UTF-8 byte length of a string. */
export function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/** Find all start indexes of `find` within `content`. */
export function findOccurrences(content: string, find: string): number[] {
  const indexes: number[] = [];
  let index = content.indexOf(find);
  while (index >= 0) {
    indexes.push(index);
    index = content.indexOf(find, index + find.length);
  }
  return indexes;
}
