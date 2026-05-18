import express from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import axios from 'axios';
import crypto from 'crypto-js';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

// --- Supabase 初始化 ---
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

/**
 * AI 提示词工作台 - Node.js 后端服务
 */

const app = express();
const PORT = 3000;
const OUTPUTS_DIR = path.join(process.cwd(), 'outputs');

// 确保输出目录存在
if (!fs.existsSync(OUTPUTS_DIR)) {
  fs.mkdirSync(OUTPUTS_DIR, { recursive: true });
}

app.use(express.json({ limit: '50mb' }));
app.use('/outputs', express.static(OUTPUTS_DIR));

const upload = multer({ storage: multer.memoryStorage() });

// --- 火山引擎 V4 签名算法实现 (对应即梦 4.0 官方文档) ---
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

// --- Gemini 初始化 ---
const getGemini = (userKey?: string) => {
  const apiKey = userKey || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('未配置 Gemini API Key');
  return new GoogleGenAI(apiKey);
};

// --- API 路由 ---

// 1. 获取模型列表
app.get('/api/models', (req, res) => {
  res.json({
    models: [
      { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview (最强模型)" },
      { id: "gemini-3-flash-preview", label: "Gemini 3 Flash (极速响应)" },
      { id: "gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash Lite (高性价比)" }
    ]
  });
});

// 2. 图像反推提示词
app.post('/api/reverse-prompt', upload.single('file'), async (req: any, res) => {
  const { model, extra_hint } = req.body;
  const userGeminiKey = req.headers['x-gemini-key'];
  
  try {
    const file = req.file;
    if (!file) throw new Error('未上传图片');

    const genAI = getGemini(userGeminiKey as string);
    const aiModel = genAI.getGenerativeModel({ model: model || 'gemini-3.1-pro-preview' });

    const sys_instructions = `你是一位世界顶级的「AI图像逆向解析大师」与「提示词架构师」。你深谙 Google Gemini Imagen 3.1 模型的自然语言生图逻辑（强调用完整、连贯的描述性长句表达画面，强调空间关系与细节，而非单词堆砌）。

# Objective
你的唯一任务是：当用户上传任何一张图片时，深度解析其画风与视觉特征，并精准输出 JSON 格式，包含且仅包含以下两个键：
- "system_prompt"：风格系统提示词（SYSTEM_CHARACTER 代码块格式）
- "image_prompt"：单图的具体画面描述提示词

# Output Format（严格按照以下 JSON 格式输出，不得有任何额外文字）
输出 JSON 中 "system_prompt" 的值必须严格遵循以下模板结构（只替换方括号内容，保留所有 \\n 和格式符号）：
"system_prompt": "### ⚙️ 批量生产系统指令 (Style System Prompt)\\n\\\`\\\`\\\`python\\nSYSTEM_CHARACTER = (您可以是一位专业、高端的[此处填入提取的画风]壁纸设计师。您的目标是将用户输入转化为具有秩序美、[此处填入该画风的核心魅力]的壁纸指令\\n\\\"【核心构图逻辑】: [此处精简概括核心排版]。\\n\\\"1. 构图与比例：9:16纵横比。[详细描述构图规则]。\\n\\\"2. 构图排版：[此处描述画面元素的分布逻辑]。\\n\\\"3. 主题内容：[此处规定AI应该如何描述用户输入的主题]。\\n\\\"4. 视觉风格：[此处极度详细地描述该画风的笔触、材质、工艺，必须包含英文专业术语]。\\n\\\"5. 氛围特征：[此处描述光影与情绪]。\\n\\\"6. 结构规范：提示词必须以“ [11字以内的中文标题] ”开头，紧接具体的画面描述，中间无空格。\\n\\\"7. 输出约束：严格执行示例格式，中文提示词总字数控制在250文字以内，不输出任何解释性文字，每个提示词独立成段。)\\n\\\`\\\`\\\`"

输出 JSON 中 "image_prompt" 的值：针对本张图片，必须严格按照“系统提示词”第6点的结构规范，将标题和具体画面描述合并在一起输出！格式必须是：\`[11字以内中文标题]详细画面描述\`。`;

    const result = await aiModel.generateContent([
      {
        inlineData: {
          data: file.buffer.toString('base64'),
          mimeType: file.mimetype
        }
      },
      { text: (sys_instructions + (extra_hint ? `\n\n用户额外说明: ${extra_hint}` : '')) }
    ]);

    const response = await result.response;
    const text = response.text();
    const cleanJson = text.replace(/```json|```/g, '');
    const data = JSON.parse(cleanJson);

    res.json({ status: 'success', data, model_used: model });
  } catch (err: any) {
    res.json({ status: 'error', message: err.message });
  }
});

// 3. 画廊同步接口 (从 Supabase 获取共享云端数据)
app.get('/api/gallery', async (req, res) => {
  try {
    const { data: items, error } = await supabase
      .from('gallery')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;

    const formattedItems = items.map(item => ({
      id: item.id,
      image_url: item.image_url,
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
    const modelKey = model || 'jimeng_t2i_v46';
    let modelVersion = "v4.0";
    if (modelKey.includes('v46')) modelVersion = "v4.6";
    else if (modelKey.includes('v3')) modelVersion = "v3.0";

    const params = { Action: 'CVProcess', Version: '2022-08-31' };
    const body = {
      req_key: modelKey,
      prompt: image_prompt,
      model_version: modelVersion,
      width: width || 1440,
      height: height || 2560
    };

    const headers = sign(params, body, ak, sk, 'CVProcess', '2022-08-31');
    const response = await axios.post(`https://visual.volcengineapi.com/?Action=CVProcess&Version=2022-08-31`, body, { headers });

    if (response.data.code !== 10000) {
       return res.json({ status: 'error', message: response.data.message || '提交任务失败' });
    }

    const taskId = response.data.data.task_id;
    
    // 轮询逻辑与 Python 原版一致
    let resultUrl = '';
    for (let i = 0; i < 50; i++) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        const checkHeaders = sign({ Action: 'GetResult', Version: '2022-08-31' }, { task_id: taskId }, ak, sk, 'GetResult', '2022-08-31');
        const checkRes = await axios.post(`https://visual.volcengineapi.com/?Action=GetResult&Version=2022-08-31`, { task_id: taskId }, { headers: checkHeaders });
        
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

    // 1. 本地保存 (仅用于兼容本地开发环境)
    try {
      fs.writeFileSync(path.join(OUTPUTS_DIR, fileName), imageBuffer);
      fs.writeFileSync(path.join(OUTPUTS_DIR, `${id}.txt`), `[Model] ${modelKey}\n[Subject] ${image_prompt}\n[Style]\n${system_prompt}`);
    } catch(e) {
      console.warn('Local save failed (expected in Serverless):', e);
    }

    // 2. 上传到 Supabase Storage
    const pathInBucket = `gallery/${fileName}`;
    const { error: uploadError } = await supabase.storage
      .from('gallery')
      .upload(pathInBucket, imageBuffer, {
        contentType: 'image/png',
        upsert: true
      });

    if (uploadError) throw uploadError;

    // 获取公开 URL
    const { data: { publicUrl } } = supabase.storage
      .from('gallery')
      .getPublicUrl(pathInBucket);

    // 3. 保存元数据到 Supabase Database
    const { error: dbError } = await supabase
      .from('gallery')
      .insert([
        {
          id: id,
          image_url: publicUrl,
          model: modelKey,
          subject: image_prompt,
          system_prompt: system_prompt,
          created_at: new Date().toISOString()
        }
      ]);

    if (dbError) throw dbError;

    res.json({ status: 'success', image_url: publicUrl });
  } catch (err: any) {
    res.json({ status: 'error', message: err.message });
  }
});

// 5. 香蕉生图接口 (Gemini 直接生成)
app.post('/api/banana-generate', async (req, res) => {
  const { prompt, model } = req.body;
  const userGeminiKey = req.headers['x-gemini-key'] as string;

  try {
    const genAI = getGemini(userGeminiKey as string);
    // 使用支持生图的模型名，例如 gemini-1.5-pro 或者预览版
    const aiModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' }); 

    const engine_system_prompt = `You are a specialized engine adept at generating cinematic-quality wallpaper images...`;
    
    const result = await aiModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: `${engine_system_prompt}\n\nTask: ${prompt}` }] }],
      // 注意：此处需要模型支持生图模态，如果是文字模型则返回提示词
    });

    const text = result.response.text();
    res.json({ status: 'success', message: 'Gemini 生图请求发送成功', raw_response: text });
  } catch (err: any) {
    res.json({ status: 'error', message: err.message });
  }
});

// 6. 批量生成
app.post('/api/batch-prompts', async (req, res) => {
  const { system_prompt, theme, count, model } = req.body;
  const userGeminiKey = req.headers['x-gemini-key'];
  try {
    const genAI = getGemini(userGeminiKey as string);
    const aiModel = genAI.getGenerativeModel({ model: model || 'gemini-3.1-pro-preview' });

    const prompt = `请严格按照系统提示词批量生成 ${count} 条提示词... 主题: ${theme}\n输出 JSON 格式: {"prompts": [...]}`;
    const result = await aiModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      systemInstruction: system_prompt
    });

    const text = result.response.text();
    const data = JSON.parse(text.replace(/```json|```/g, ''));
    res.json({ status: 'success', prompts: data.prompts });
  } catch (err: any) {
    res.json({ status: 'error', message: err.message });
  }
});

// --- 迁移脚本：将本地 outputs 同步到 Supabase ---
async function syncLocalGallery() {
  try {
    const { count, error: countError } = await supabase
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

        // 上传到 Storage
        await supabase.storage
          .from('gallery')
          .upload(pathInBucket, imageBuffer, { contentType: 'image/png' });

        const { data: { publicUrl } } = supabase.storage
          .from('gallery')
          .getPublicUrl(pathInBucket);

        // 插入数据库
        await supabase
          .from('gallery')
          .insert([{
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
    console.error('Failed to sync gallery:', e);
  }
}

// --- 启动 Vite ---
async function start() {
  await syncLocalGallery();

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
    app.get('*', (req, res) => res.sendFile(path.join(process.cwd(), 'dist/index.html')));
  }
  app.listen(PORT, '0.0.0.0', () => console.log(`Workbench running at http://localhost:${PORT}`));
}

start();
