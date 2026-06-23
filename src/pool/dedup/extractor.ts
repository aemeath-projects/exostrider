/** 去重键提取器 —— 使用方注入具体策略。返回 null 表示不去重，透传。 */
export interface DedupKeyExtractor<TEvent> {
  extract(event: TEvent): string | null
}
