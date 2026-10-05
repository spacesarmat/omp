/** Russian plural forms: 1 раздача, 2 раздачи, 5 раздач. */
export interface Plural { one: string; few: string; many: string }
/** English plural forms: 1 torrent, 2 torrents. */
export interface EnPlural { one: string; other: string }
/** The English dictionary has the Russian shape, with English plural objects. */
export type EnDict<T> = { [K in keyof T]: T[K] extends string ? string : T[K] extends Plural ? EnPlural : EnDict<T[K]> };
type Join<P extends string, K extends string> = P extends '' ? K : `${P}.${K}`;
/** Dot paths of the string leaves. */
export type StringKeys<T, P extends string = ''> = { [K in keyof T & string]: T[K] extends string ? Join<P, K> : T[K] extends Plural ? never : StringKeys<T[K], Join<P, K>> }[keyof T & string];
/** Dot paths of the plural leaves. */
export type PluralKeys<T, P extends string = ''> = { [K in keyof T & string]: T[K] extends string ? never : T[K] extends Plural ? Join<P, K> : PluralKeys<T[K], Join<P, K>> }[keyof T & string];
