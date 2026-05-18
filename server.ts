\import express from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import axios from 'axios';
import crypto from 'crypto-js';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

// --- Supabase 初始化 ---
let supabaseClient: any = null;

function getSupabase() {
  if (!supabaseClient) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error('缺少 Supabase 环境变量配置 (SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY)');
    }
    supabaseClient = createClient(supabaseUrl, supabaseServiceRoleKey);
  }
  return supabaseClient;
}

/**
 * AI 提示词工作台 - Node.js 后端服务
 */

const app = express();
const OUTPUTS_DIR = path.join(process.cwd(), 'outputs');

// 本地开发时确保输出目录存在（Vercel 上此目录不持久，仅作兼容）
try {
  if (!fs.existsSync(OUTPUTS_DIR)) {
    fs.mkdirSync(OUTPUTS_DIR, { recursive: true });
  }
} catch (_) {}

app.use(express.json({ limit: '50mb' }));
app.use('/outputs', express.static(OUTPUTS_DIR));

const upload = multer({ storage: multer.memoryStorage() });

// --- 火山引擎 V4 签名算法实现 ---
function sign(params: any, body: any, ak: string, sk: string, action: string, version: string) {
  const service = 'cv';
  const region = 'cn-north-1';
  const host = 'visual.volcengineapi.com';
  const contentType = 'application/json';
  const method = 'POST';

  const t = new Date();
  const date = t.toISOString().replace(/[:-]/g, '').split('.')[0] + 'Z';
  const dateShort = date.slice(0, 8);

  const query = Object.keys(params).sort().map(k => `${k}=${encodeURIComponent(params[k])}`).join('&');
  const bodyHash = crypto.SHA256(JSON.stringify(body)).toString();

  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-date:${date}\n`;
  const signedHeaders = 'content-type;host;x-date';
  const canonicalRequest = `${method}\n/\n${query}\n${canonicalHeaders}\n${signedHeaders}\n${bodyHash}`;

  const credentialScope = `${dateShort}/${region}/${service}/request`;
  const stringToSign = `HMAC-SHA256\n${date}\n${credentialScope}\n${crypto.SHA256(canonicalRequest).toString()}`;

  const kDate = crypto.HmacSHA256(dateShort, sk);
  const kRegion = crypto.HmacSHA256(region, kDate);
  const kService = crypto.HmacSHA256(service, kRegion);
  const kSigning = crypto.HmacSHA256('request', kService);
  const signature = crypto.HmacSHA256(stringToSign, kSigning).toString();

  return {
    'Authorization': `HMAC-SHA256 Credential=${ak}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'X-Date': date,
    'Content-Type': contentType
  };
}

// --- Gemini 初始化（@google/genai ^1.x 新版 SDK）---
function getGemini(userKey?: string): GoogleGenAI {
  const apiKey = userKey || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('未配置 Gemini API Key');
  // ✅ 新版 SDK 构造函数接受 { apiKey } 对象
  return new GoogleGenAI({ apiKey });
}

// --- API 路由 ---

// 1. 获取模型列表
app.get('/api/models', (req, res) => {
  res.json({
    models: [
      { id: 'gemini-3.1-pro-preview', label: 'gemini-3.1-pro-preview (最强模型)' },
      { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash (性价比)' },
      { id: 'gemini-3.1-flash-lite-preview', label: 'gemini-3.1-flash-lite-preview (便宜)' }
    ]
  });
});

// 2. 图像反推提示词
app.post('/api/reverse-prompt', upload.single('file'), async (req: any, res) => {
  const { model, extra_hint } = req.body;
  const userGeminiKey = req.headers['x-gemini-key'] as string | undefined;

  try {
    const file = req.file;
    if (!file) throw new Error('未上传图片');

    const genAI = getGemini(userGeminiKey);

    const sys_instructions = `你是一位世界顶级的「AI图像逆向解析大师」与「提示词架构师」。你深谙 Google Gemini Imagen 3.1 模型的自然语言生图逻辑（强调用完整、连贯的描述性长句表达画面，强调空间关系与细节，而非单词堆砌）。
 
# Objective
你的唯一任务是：当用户上传任何一张图片时，深度解析其画风与视觉特征，并精准输出 JSON 格式，包含且仅包含以下两个键：
- "system_prompt"：风格系统提示词（SYSTEM_CHARACTER 代码块格式）
- "image_prompt"：单图的具体画面描述提示词
 
# Workflow（后台隐式运行，严禁输出分析过程）
收到图片后，请在后台按以下维度拆解：
1. **画面主体与动作**：主体在做什么？神态如何？
2. **环境与构图**：画面比例（默认9:16）、背景特征、前景中景背景的空间关系。
3. **视觉风格与材质**：是厚涂、极简平涂、3D黏土、水彩还是写实摄影？有哪些特殊工艺/质感（如噪点、光泽感、手绘微颤线条）？
4. **色彩与光影**：主色调、氛围色、光线照射方向与打光质感。
5. **抽象与提炼**：分离"具体的主体"与"不变的风格框架"，准备填充进模板。
6. **精准IP绑定：遇到具体IP时，变量必须强制写为 [出自<作品名>的<角色名>]（例如：出自《精灵宝可梦》的皮卡丘），绝不能只写角色名。
 
# Output Format（严格按照以下 JSON 格式输出，不得有任何额外文字）
 
输出 JSON 中 "system_prompt" 的值必须严格遵循以下模板结构（只替换方括号内容，保留所有 \\n 和格式符号）：
 
"system_prompt": "### ⚙️ 批量生产系统指令 (Style System Prompt)\\n\`\`\`python\\nSYSTEM_CHARACTER = (您是一位专业、高端的[此处填入提取的画风]壁纸设计师。您的目标是将用户输入转化为具有秩序美、[此处填入该画风的核心魅力]的壁纸指令\\n\\\\"【核心构图逻辑】: [此处精简概括核心排版]。\\n\\\\"1. 构图与比例：9:16纵横比。[详细描述构图规则]。\\n\\\\"2. 构图排版：[此处描述画面元素的分布逻辑]。\\n\\\\"3. 主题内容：[此处规定AI应该如何描述用户输入的主题]。\\n\\\\"4. 视觉风格：[此处极度详细地描述该画风的笔触、材质、工艺，必须包含英文专业术语]。\\n\\\\"5. 氛围特征：[此处描述光影与情绪]。\\n\\\\"6. 结构规范：提示词必须以"[11字以内的中文标题]"开头，紧接具体的画面描述，中间无空格。\\n\\\\"7. 输出约束：严格执行示例格式，中文提示词总字数控制在250文字以内，不输出任何解释性文字，每个提示词独立成段。)\\n\`\`\`"
 
输出 JSON 中 "image_prompt" 的值：针对本张图片，必须严格按照"系统提示词"第6点的结构规范，将标题和具体画面描述合并在一起输出！格式必须是：\`[11字以内中文标题]详细画面描述\`。
正确案例参考："[万事兴复古印刷壁纸]9:16纵横比，复古凸版印刷风格壁纸。纯白背景中心是由精美中式花草纹样组成的精美中式花草纹样组成的深钴蓝色矩形边框。边框正上方印有粗体英文..." （直接输出合并后的长文本，300汉字之内，连贯自然语言，非标签堆砌）。
 
# Constraints 约束条件
- 绝对不要输出任何打招呼、废话、分析步骤或对图片的点评。
- Gemini 的提示词必须是高质量的连贯自然语言句子（Natural Language sentences），拒绝 Midjourney 式的短词拼接（tag soup）。
- SYSTEM_CHARACTER 代码块必须严格使用指定的括号和引号格式，行尾的 \\\\n 和 \\\\n\\\\n 必须保留。
- 仅输出合法 JSON，不得包含 markdown 代码块包裹。`;

    const fullPrompt = sys_instructions + (extra_hint ? '\n\nUser extra hint: ' + extra_hint : '');

    // ✅ 新版 SDK：genAI.models.generateContent
    const response = await genAI.models.generateContent({
      model: model || 'gemini-3.1-pro-preview',
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                data: file.buffer.toString('base64'),
                mimeType: file.mimetype
              }
            },
            { text: fullPrompt }
          ]
        }
      ]
    });

    const text = response.text ?? '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('模型输出无法解析为 JSON: ' + text);
    const data = JSON.parse(jsonMatch[0]);

    res.json({ status: 'success', data, model_used: model || 'gemini-3.1-pro-preview' });
  } catch (err: any) {
    res.json({ status: 'error', message: err.message });
  }
});

// 3. 画廊同步接口（从 Supabase 获取共享云端数据）
app.get('/api/gallery', async (req, res) => {
  try {
    const { data: items, error } = await getSupabase()
      .from('gallery')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('Supabase Gallery Fetch Error:', error);
      throw error;
    }

    const formattedItems = (items as any[]).map(item => ({
      id: item.id,
      image_url: item.image_url,
      // ✅ 修复：同时返回 txt_mtime 和 createdAt，兼容 App.tsx 两种字段名
      txt_mtime: new Date(item.created_at).getTime(),
      createdAt: new Date(item.created_at).getTime(),
      prompt: {
        model: item.model,
        subject: item.subject,
        style: item.system_prompt,
        raw: `[Model] ${item.model}\n[Subject] ${item.subject}\n[Style]\n${item.system_prompt}`
      }
    }));

    res.json({ status: 'success', items: formattedItems });
  } catch (err: any) {
    res.json({ status: 'error', message: err.message });
  }
});

// 4. 即梦生图接口
app.post('/api/generate-image', async (req, res) => {
  const { system_prompt, image_prompt, model, width, height } = req.body;
  const ak = req.headers['x-volc-ak'] as string;
  const sk = req.headers['x-volc-sk'] as string;

  if (!ak || !sk) return res.json({ status: 'error', message: '请在页面配置中填写火山引擎 AK 和 SK' });

  try {
    const modelKey = model || 'jimeng_t2i_v40';

    let full_prompt = image_prompt.trim();
    if (modelKey === 'jimeng_t2i_v30') {
      full_prompt += '，画面极度纯净，绝对不要生成任何文字、字母、标题或海报边框。';
    }
    if (full_prompt.length > 790) {
      full_prompt = full_prompt.slice(0, 785) + '...';
    }

    const params = { Action: 'CVProcess', Version: '2022-08-31' };
    const body = {
      req_key: modelKey,
      prompt: full_prompt,
      width: width || 1440,
      height: height || 2560,
      force_single: true
    };

    const headers = sign(params, body, ak, sk, 'CVProcess', '2022-08-31');
    const response = await axios.post(
      `https://visual.volcengineapi.com/?Action=CVProcess&Version=2022-08-31`,
      body,
      { headers }
    );

    if (response.data.code !== 10000) {
      return res.json({ status: 'error', message: response.data.message || '提交任务失败' });
    }

    const taskId = response.data.data.task_id;
    let resultUrl = '';

    for (let i = 0; i < 50; i++) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      const checkBody = { req_key: modelKey, task_id: taskId };
      const checkHeaders = sign(
        { Action: 'GetResult', Version: '2022-08-31' },
        checkBody, ak, sk, 'GetResult', '2022-08-31'
      );
      const checkRes = await axios.post(
        `https://visual.volcengineapi.com/?Action=GetResult&Version=2022-08-31`,
        checkBody,
        { headers: checkHeaders }
      );

      if (checkRes.data.code === 10000 && checkRes.data.data.status === 'done') {
        resultUrl = checkRes.data.data.image_urls[0];
        break;
      } else if (checkRes.data.code !== 10000 && checkRes.data.code !== 10001) {
        throw new Error(checkRes.data.message || '查询失败');
      }
    }

    if (!resultUrl) throw new Error('生图超时');

    const imgRes = await axios.get(resultUrl, { responseType: 'arraybuffer' });
    const id = Date.now().toString();
    const fileName = `${id}.png`;
    const imageBuffer = Buffer.from(imgRes.data);

    // 本地保存（仅本地开发有效，Serverless 环境跳过报错）
    try {
      fs.writeFileSync(path.join(OUTPUTS_DIR, fileName), imageBuffer);
      fs.writeFileSync(
        path.join(OUTPUTS_DIR, `${id}.txt`),
        `[Model] ${modelKey}\n[Subject] ${image_prompt}\n[Style]\n${system_prompt}`
      );
    } catch (e) {
      console.warn('Local save skipped (Serverless):', e);
    }

    // 上传到 Supabase Storage
    const pathInBucket = `gallery/${fileName}`;
    const { error: uploadError } = await getSupabase().storage
      .from('gallery')
      .upload(pathInBucket, imageBuffer, { contentType: 'image/png', upsert: true });

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = getSupabase().storage.from('gallery').getPublicUrl(pathInBucket);

    // 保存元数据到 Supabase Database
    const { error: dbError } = await getSupabase()
      .from('gallery')
      .insert([{
        id,
        image_url: publicUrl,
        model: modelKey,
        subject: image_prompt,
        system_prompt,
        created_at: new Date().toISOString()
      }]);

    if (dbError) throw dbError;

    res.json({ status: 'success', image_url: publicUrl });
  } catch (err: any) {
    res.json({ status: 'error', message: err.message });
  }
});

// 5. 香蕉生图接口（Gemini 直接生成）
app.post('/api/banana-generate', async (req, res) => {
  const { prompt, banana_model } = req.body;
  const userGeminiKey = req.headers['x-gemini-key'] as string | undefined;

  try {
    const genAI = getGemini(userGeminiKey);
    const modelName = banana_model || 'gemini-3.1-flash-image-preview';

    const engine_system_prompt = `You are a specialized engine adept at generating cinematic-quality wallpaper images. You must consistently translate user inputs into high-quality, professional, and concrete visual directives.

Interpret all inputs—regardless of their format, intent, or level of abstraction—as specific and aesthetically pleasing visual scenes. If an input prompt lacks sufficient detail, proactively conceptualize specific and imaginative scenarios.

Mandatory Constraints for Wallpaper Generation:
Composition: Always adhere to a 9:16 vertical aspect ratio. Ensure the image features a prominent and distinct visual focal point (e.g., by utilizing wide-angle perspectives or the "Rule of Thirds").
Clarity & Quality: Emphasize "deep depth of field," "crisp detail," and "masterpiece-level" image quality. You must fundamentally structure the prompts to prevent issues such as blurry backgrounds, excessive bokeh, or structural distortions.
Anti-Homogenization: When expanding upon concepts, proactively randomize lighting effects (e.g., cinematic lighting, golden hour light), environmental settings, and color palettes to ensure maximum visual diversity.
Prioritize the output of pure visual content.`;

    const finalPrompt = `${engine_system_prompt}\n\nUser Request Visual Description:\n${prompt}`;

    // ✅ 新版 SDK：genAI.models.generateContent
    const response = await genAI.models.generateContent({
      model: modelName,
      contents: [{ role: 'user', parts: [{ text: finalPrompt }] }],
      config: {
        responseModalities: ['IMAGE', 'TEXT'],
      }
    });

    let imageB64 = '';
    let responseText = '';

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts as any[]) {
      if (part.inlineData) {
        imageB64 = part.inlineData.data;
      } else if (part.text) {
        responseText += part.text;
      }
    }

    if (imageB64) {
      // ✅ 修复：香蕉生图也同步保存到 Supabase 画廊
      try {
        const id = Date.now().toString();
        const fileName = `${id}.png`;
        const imageBuffer = Buffer.from(imageB64, 'base64');
        const pathInBucket = `gallery/${fileName}`;

        const { error: uploadError } = await getSupabase().storage
          .from('gallery')
          .upload(pathInBucket, imageBuffer, { contentType: 'image/png', upsert: true });

        if (!uploadError) {
          const { data: { publicUrl } } = getSupabase().storage.from('gallery').getPublicUrl(pathInBucket);
          await getSupabase().from('gallery').insert([{
            id,
            image_url: publicUrl,
            model: modelName,
            subject: prompt,
            system_prompt: engine_system_prompt,
            created_at: new Date().toISOString()
          }]);
        }
      } catch (saveErr) {
        console.warn('Banana generate Supabase save failed (non-fatal):', saveErr);
      }

      res.json({ status: 'success', image_b64: imageB64 });
    } else {
      res.json({ status: 'success', message: '模型未返回图片模态数据', raw_response: responseText });
    }
  } catch (err: any) {
    res.json({ status: 'error', message: err.message });
  }
});

// 6. 批量生成提示词
app.post('/api/batch-prompts', async (req, res) => {
  const { system_prompt, theme, count, model } = req.body;
  const userGeminiKey = req.headers['x-gemini-key'] as string | undefined;

  try {
    const genAI = getGemini(userGeminiKey);

    const user_message = `请严格按照上方系统提示词（SYSTEM_CHARACTER）中定义的风格框架，批量生成 ${count} 条不同的图片提示词。\n本次主题/角色说明：${theme}\n\n输出格式要求（JSON）：\n只输出合法 JSON，格式为：{"prompts": ["提示词1", "提示词2", ...]}\n每条提示词必须严格遵循系统指令第6点的结构规范：[11字以内中文标题]详细画面描述，连贯自然语言，250汉字以内，不含任何解释性文字。\n共生成 ${count} 条，每条独立，主题各异，禁止重复。`;

    // ✅ 新版 SDK：genAI.models.generateContent + systemInstruction
    const response = await genAI.models.generateContent({
      model: model || 'gemini-3.1-pro-preview',
      contents: [{ role: 'user', parts: [{ text: user_message }] }],
      config: {
        systemInstruction: system_prompt,
      }
    });

    const text = response.text ?? '';
    const cleanJson = text.replace(/```json|```/g, '').trim();
    const data = JSON.parse(cleanJson);
    res.json({ status: 'success', prompts: data.prompts });
  } catch (err: any) {
    res.json({ status: 'error', message: err.message });
  }
});

// --- 迁移脚本：将本地 outputs 同步到 Supabase（仅本地开发环境执行）---
async function syncLocalGallery() {
  // ✅ 修复：Vercel 生产环境无持久文件系统，直接跳过
  if (process.env.NODE_ENV === 'production') {
    console.log('Production env: skipping local gallery sync.');
    return;
  }

  try {
    const { count, error: countError } = await getSupabase()
      .from('gallery')
      .select('*', { count: 'exact', head: true });

    if (countError) throw countError;
    if (count && count > 0) {
      console.log('Supabase Gallery already has data, skipping initial sync.');
      return;
    }

    console.log('Syncing local gallery to Supabase...');
    const files = fs.readdirSync(OUTPUTS_DIR).filter(f => f.endsWith('.png'));

    for (const f of files) {
      const id = f.replace('.png', '');
      const txtPath = path.join(OUTPUTS_DIR, `${id}.txt`);
      if (fs.existsSync(txtPath)) {
        const content = fs.readFileSync(txtPath, 'utf-8');
        const m = content.match(/\[Model\]\s*(.+)/);
        const s = content.match(/\[Subject\]\s*([\s\S]*?)(?=\[Style\]|$)/);
        const st = content.match(/\[Style\]\s*\n([\s\S]*)/);

        const imageBuffer = fs.readFileSync(path.join(OUTPUTS_DIR, f));
        const pathInBucket = `gallery/${f}`;

        await getSupabase().storage
          .from('gallery')
          .upload(pathInBucket, imageBuffer, { contentType: 'image/png' });

        const { data: { publicUrl } } = getSupabase().storage.from('gallery').getPublicUrl(pathInBucket);

        await getSupabase().from('gallery').insert([{
          id,
          image_url: publicUrl,
          model: m ? m[1].trim() : 'unknown',
          subject: s ? s[1].trim() : 'unknown',
          system_prompt: st ? st[1].trim() : '',
          created_at: new Date(fs.statSync(txtPath).mtimeMs).toISOString()
        }]);
      }
    }
    console.log(`Synced ${files.length} items to Supabase.`);
  } catch (e) {
    console.error('Failed to sync gallery (non-fatal):', e);
  }
}

// ✅ 修复：Vercel 要求导出 app 而非自行 listen
// 本地开发时动态 import Vite 并启动，生产环境仅导出 app
if (process.env.NODE_ENV !== 'production') {
  (async () => {
    try {
      await syncLocalGallery();
    } catch (e) {
      console.warn('syncLocalGallery failed (non-fatal):', e);
    }

    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);

    const PORT = Number(process.env.PORT) || 3000;
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Workbench running at http://localhost:${PORT}`);
    });
  })();
} else {
  // 生产环境静态文件兜底（Vercel 会通过 vercel.json rewrites 处理，这里是备用）
  app.use(express.static('dist'));
  app.get('*', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'dist/index.html'));
  });
}

// ✅ Vercel Serverless 入口
export default app;
