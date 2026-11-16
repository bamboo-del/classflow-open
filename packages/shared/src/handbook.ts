import { z } from 'zod';

export type HandbookField = {
  label: string;
  type?: 'text' | 'date' | 'month' | 'number' | 'textarea';
  required?: boolean;
  max?: number;
  options?: readonly string[];
};
const field = (label: string, type: HandbookField['type'] = 'text', required = false): HandbookField => ({ label, type, required });
const person = [field('姓名', 'text', true), field('学号'), field('性别'), field('联系电话')];
const meeting = [field('会议主题', 'text', true), field('时间', 'date', true), field('地点'), field('主持人'), field('记录人'), field('应到人数', 'number'), field('实到人数', 'number'), field('缺席人数', 'number'), field('会议内容', 'textarea')];
const transfer = [field('姓名', 'text', true), field('学号'), field('性别'), field('入团时间', 'month'), field('入团地点'), field('团内职务'), field('联系电话')];
export const handbookKinds = ['branch', 'committee', 'members', 'activists', 'recommendations', 'transferOut', 'transferIn', 'dues', 'reviews', 'awards', 'assembly', 'committeeMeeting', 'groupMeeting', 'lesson', 'activity'] as const;
export type HandbookKind = typeof handbookKinds[number];
export type HandbookSection = { id: HandbookKind; title: string; group: '基本情况篇' | '组织生活篇'; source: string; hint: string; fields: HandbookField[] };
export const handbookSections: HandbookSection[] = [
  { id: 'branch', title: '团支部基本信息', group: '基本情况篇', source: '05 团支部基本信息', hint: '记录支部成立时间与集体荣誉；支委成员在「支委班子」中逐人登记。手册贯穿大学全程，换届时做好移交。', fields: [field('团支部名称', 'text', true), field('所属学院'), field('成立时间', 'month'), field('团支部荣誉', 'textarea')] },
  { id: 'committee', title: '支委班子', group: '基本情况篇', source: '05 团支部基本信息', hint: '手册说明：7人以上设支委会，通常由3至5人组成；不足7人设书记，必要时可设副书记。逐人记录职务和任职时间。', fields: [field('姓名', 'text', true), field('团支部职务', 'text', true), field('任职时间', 'month'), field('工作分工', 'textarea')] },
  { id: 'members', title: '团员名册', group: '基本情况篇', source: '06 团员名册', hint: '按实际情况维护团员信息。发生组织关系转入、转出时，同时更新本表「变动」栏。', fields: [field('姓名', 'text', true), field('学号'), field('性别'), field('民族'), field('籍贯'), field('出生年月', 'month'), field('入团时间', 'month'), field('入团地点'), field('团内职务'), field('联系电话'), field('变动', 'textarea')] },
  { id: 'activists', title: '入团积极分子', group: '基本情况篇', source: '07 入团积极分子名单', hint: '分别记录递交入团申请书和确定积极分子的时间。确定为发展对象前，集中团课学习应不少于8学时（见手册团课说明）。', fields: [...person, field('民族'), field('出生年月', 'month'), field('籍贯'), field('担任职务'), field('递交入团申请书时间', 'month'), field('确定入团积极分子时间', 'month')] },
  { id: 'recommendations', title: '推优入党', group: '基本情况篇', source: '08 推优入党情况登记表', hint: '各阶段按实际进展填写，尚未到达的阶段留空。', fields: [...person, field('担任职务'), field('递交入党申请书时间', 'month'), field('推荐入党积极分子时间', 'month'), field('确定为发展对象时间', 'month'), field('确定为预备党员时间', 'month'), field('预备党员转正时间', 'month')] },
  { id: 'transferOut', title: '组织关系转出', group: '基本情况篇', source: '09 团组织关系转出登记表', hint: '登记转出时间、原因及转往支部后，请同步更新「团员名册」的变动栏。', fields: [...transfer, field('转出时间', 'month'), field('转出原因'), field('转出团支部')] },
  { id: 'transferIn', title: '组织关系转入', group: '基本情况篇', source: '10 团组织关系转入登记表', hint: '登记转入时间、原因及原支部后，请同步更新「团员名册」的变动栏。', fields: [...transfer, field('转入时间', 'month'), field('转入原因'), field('原团支部')] },
  { id: 'dues', title: '团费收缴', group: '基本情况篇', source: '11 团费收缴记录', hint: '每次收缴登记一条记录，分别核对应缴与实缴人数、金额。金额单位为元。', fields: [field('缴纳时间', 'date', true), field('应缴人数', 'number'), field('应缴金额（元）', 'number'), field('实缴人数', 'number'), field('实缴金额（元）', 'number'), field('备注', 'textarea')] },
  { id: 'reviews', title: '团员教育评议', group: '基本情况篇', source: '12 团员教育评议结果记录', hint: '每名团员每年度登记一条，便于持续记录大学期间的教育评议。年度团籍注册需另按上级团组织要求办理。', fields: [field('姓名', 'text', true), field('学号'), field('性别'), { label: '评议年度', type: 'number', required: true }, { label: '评议结果', required: true, options: ['优秀', '合格', '基本合格', '不合格'] }] },
  { id: 'awards', title: '奖惩登记', group: '基本情况篇', source: '13 团员青年、团干部奖惩情况登记表', hint: '奖励、处分按实际发生情况填写；没有发生的项目留空。', fields: [field('姓名', 'text', true), field('获奖时间', 'month'), field('奖励级别'), field('奖励内容', 'textarea'), field('处分时间', 'month'), field('处分级别、类型'), field('处分原因', 'textarea')] },
  { id: 'assembly', title: '支部团员大会', group: '组织生活篇', source: '15–19 支部团员大会说明及记录', hint: '手册要求每季度至少召开一次。记录议程、讨论情况、选举结果及重要事项决议，会议结束后及时归档。', fields: meeting },
  { id: 'committeeMeeting', title: '支部委员会', group: '组织生活篇', source: '20–25 支部委员会说明及记录', hint: '手册要求每月至少召开一次。记录主要议题、每位委员发言摘要和通过的决议。', fields: meeting },
  { id: 'groupMeeting', title: '团小组会议', group: '组织生活篇', source: '26–28 团小组会议说明及记录', hint: '一般每月召开一次，根据支部实际情况安排，不作强制要求。记录议题、成员发言摘要及通过的内容。', fields: meeting },
  { id: 'lesson', title: '团课记录', group: '组织生活篇', source: '29–33 团课说明及记录', hint: '每季度安排一次团课。记录主要内容与学习感悟；入团积极分子在确定为发展对象前，集中团课学习应不少于8学时。', fields: [field('团课主题', 'text', true), field('时间', 'date', true), field('地点'), field('主讲人'), field('记录人'), field('应到人数', 'number'), field('实到人数', 'number'), field('缺席人数', 'number'), field('团课内容与学习感悟', 'textarea')] },
  { id: 'activity', title: '主题团日活动', group: '组织生活篇', source: '34–39 主题团日指南及记录', hint: '一般每月一次，每学期至少4次、每学年至少8次。寒暑假可结合实际组织线上学习或社会实践。活动情况不超过300字，总结要求图文并茂。', fields: [field('团日活动名称', 'text', true), field('活动时间', 'date', true), field('活动地点'), field('组织者'), field('参与人数', 'number'), { label: '活动情况', type: 'textarea', max: 300 }, field('活动总结', 'textarea')] },
];

export const handbookInput = z.strictObject({
  kind: z.enum(handbookKinds),
  values: z.record(z.string(), z.string().max(20000)),
  photos: z.array(z.strictObject({ name: z.string().max(200), data: z.string().max(700000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/) })).max(4).default([]),
}).superRefine((record, ctx) => {
  const section = handbookSections.find((s) => s.id === record.kind)!;
  const issue = (label: string, message: string) => ctx.addIssue({ code: 'custom', path: ['values', label], message });
  for (const key of Object.keys(record.values)) {
    if (!section.fields.some((f) => f.label === key)) issue(key, '未知栏目');
  }
  for (const f of section.fields) {
    const value = record.values[f.label]?.trim() ?? '';
    if (!value) { if (f.required) issue(f.label, '不能为空'); continue; }
    if (value.length > (f.max ?? (f.type === 'textarea' ? 20000 : 200))) issue(f.label, '超出字数限制');
    if (f.options && !f.options.includes(value)) issue(f.label, '请选择有效选项');
    if (f.type === 'date' && !z.iso.date().safeParse(value).success) issue(f.label, '日期无效');
    if (f.type === 'month' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) issue(f.label, '年月无效');
    if (f.type === 'number') {
      const decimal = f.label.includes('金额');
      if (!(decimal ? /^\d+(\.\d{1,2})?$/ : /^\d+$/).test(value) || Number(value) > Number.MAX_SAFE_INTEGER / 100) issue(f.label, decimal ? '请输入非负金额，最多两位小数' : '请输入非负整数');
      if (f.label === '评议年度' && !/^\d{4}$/.test(value)) issue(f.label, '请输入四位年份');
    }
  }
  const counts = ['应到人数', '实到人数', '缺席人数'].map((k) => record.values[k]?.trim());
  if (counts.every((v) => v)) {
    if (Number(counts[0]) !== Number(counts[1]) + Number(counts[2])) issue('缺席人数', '实到人数与缺席人数之和应等于应到人数');
  } else if (counts[0] && counts[1] && Number(counts[1]) > Number(counts[0])) issue('实到人数', '不能超过应到人数');
  if (section.group !== '组织生活篇' && record.photos.length) issue('图片资料', '仅组织生活记录支持图片');
});
export const handbookRecord = handbookInput.safeExtend({ id: z.uuid(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() });
export type HandbookInput = z.infer<typeof handbookInput>;
export type HandbookRecord = z.infer<typeof handbookRecord>;

export function handbookReminders(records: HandbookRecord[], date: string) {
  const month = date.slice(0, 7), year = date.slice(0, 4), q = Math.floor((Number(date.slice(5, 7)) - 1) / 3);
  return [
    { kind: 'committeeMeeting', label: '本月支委会', period: '每月至少一次', matches: (d: string) => d.startsWith(month) },
    { kind: 'activity', label: '本月主题团日', period: '一般每月一次，学期至少4次', matches: (d: string) => d.startsWith(month) },
    { kind: 'assembly', label: '本季度团员大会', period: '每季度至少一次', matches: (d: string) => d.startsWith(year) && Math.floor((Number(d.slice(5, 7)) - 1) / 3) === q },
    { kind: 'lesson', label: '本季度团课', period: '每季度一次', matches: (d: string) => d.startsWith(year) && Math.floor((Number(d.slice(5, 7)) - 1) / 3) === q },
  ].map((item) => ({ ...item, count: records.filter((r) => r.kind === item.kind && item.matches(r.values['时间'] ?? r.values['活动时间'] ?? '')).length }));
}
