-- Initial official policy sources for the Policy Impact Terminal.
-- Run after supabase/schema.sql.

insert into public.policy_sources (
  source_key,
  name,
  source_type,
  authority_level,
  homepage_url,
  list_url,
  jurisdiction,
  publisher,
  reliability_score,
  crawl_priority,
  dedupe_priority,
  status,
  metadata
)
values
  (
    'gov_zhengce_latest',
    '中国政府网 - 最新政策',
    'official',
    'primary',
    'https://www.gov.cn/',
    'https://www.gov.cn/zhengce/zuixin/',
    'CN',
    '中国政府网',
    96,
    95,
    80,
    'active',
    jsonb_build_object(
      'notes', '中央政策聚合入口，可能转发部委原发政策；去重时不只依赖 URL。',
      'dedupeRole', 'central_aggregator',
      'userProvided', true
    )
  ),
  (
    'ndrc_policy_documents',
    '国家发展改革委 - 政策文件库',
    'official',
    'primary',
    'https://www.ndrc.gov.cn/',
    'https://www.ndrc.gov.cn/xxgk/wjk/',
    'CN',
    '国家发展改革委',
    95,
    90,
    90,
    'active',
    jsonb_build_object(
      'notes', '部委文件库，作为发改委原发政策的优先来源。',
      'dedupeRole', 'ministry_primary',
      'userProvided', true
    )
  ),
  (
    'miit_policy_library',
    '工业和信息化部 - 政策文件库',
    'official',
    'primary',
    'https://www.miit.gov.cn/',
    'https://www.miit.gov.cn/search/zcwjk.html?websiteid=110000000000000&pg=&p=&tpl=14&category=183&q=',
    'CN',
    '工业和信息化部',
    95,
    88,
    90,
    'active',
    jsonb_build_object(
      'notes', '工信部政策文件检索入口，后续抓取需要处理查询参数与分页。',
      'dedupeRole', 'ministry_primary',
      'userProvided', true
    )
  ),
  (
    'nda_policy_release',
    '国家数据局 - 政策发布',
    'official',
    'primary',
    'https://www.nda.gov.cn/',
    'https://www.nda.gov.cn/sjj/zwgk/zcfb/list/index_pc_1.html',
    'CN',
    '国家数据局',
    94,
    92,
    88,
    'active',
    jsonb_build_object(
      'notes', '国家数据局政策发布入口，可能包含政策原文、解读和多部门转载。',
      'dedupeRole', 'agency_primary_or_repost',
      'userProvided', true
    )
  )
on conflict (source_key) do update
set
  name = excluded.name,
  source_type = excluded.source_type,
  authority_level = excluded.authority_level,
  homepage_url = excluded.homepage_url,
  list_url = excluded.list_url,
  jurisdiction = excluded.jurisdiction,
  publisher = excluded.publisher,
  reliability_score = excluded.reliability_score,
  crawl_priority = excluded.crawl_priority,
  dedupe_priority = excluded.dedupe_priority,
  status = excluded.status,
  metadata = public.policy_sources.metadata || excluded.metadata,
  updated_at = now();
