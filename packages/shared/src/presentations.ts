import { z } from 'zod';

export const presentationLimit = 16 * 1024 * 1024;
export const presentationInput = z.strictObject({
  title: z.string().trim().min(1, '请输入课件名称').max(200),
  description: z.string().max(2000).default(''),
  // eslint-disable-next-line no-control-regex -- uploaded filenames cannot contain control characters
  filename: z.string().max(200).regex(/^[^/\\\u0000-\u001f]+\.html?$/i, '请选择 HTML 文件'),
  html: z.string().min(1).max(presentationLimit),
});
export type PresentationInput = z.infer<typeof presentationInput>;
export type Presentation = Omit<PresentationInput, 'html'> & {
  id: string;
  bytes: number;
  createdAt: string;
  updatedAt: string;
};
