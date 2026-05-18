# AI 提示词工作台 - 独立部署指南 (Supabase 版)

本项目已切换至 **Supabase** 作为后端数据库和存储方案，完美解决 Firebase 项目限额问题。

## 1. Supabase 设置步骤

### A. 创建数据库表 (SQL Editor)
在 Supabase 的 SQL Editor 中执行以下代码来创建画廊表：
```sql
-- 创建画廊表
create table gallery (
  id text primary key,
  image_url text not null,
  model text,
  subject text,
  system_prompt text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 启用行级安全 (RLS)
alter table gallery enable row level security;

-- 允许所有人读取画廊 (公开)
create policy "Allow public read access" on gallery for select using (true);

-- 允许后端 Service Role 写入
create policy "Allow service role insert" on gallery for insert with check (true);
```

### B. 创建存储桶 (Storage)
1. 在 Supabase Dashboard 进入 **Storage**。
2. 点击 **New Bucket**，创建一个名为 `gallery` 的存储桶。
3. **重要**：将存储桶设置为 **Public**，这样图片链接才能被直接访问。

## 2. 部署到 Vercel (推荐)

1. **导出代码**: 点击 AI Studio 界面右上角的 **Settings -> Export -> GitHub**，将代码推送到您的 GitHub 账号。
2. **关联 Vercel**:
   - 登录 [Vercel](https://vercel.com/)，点击 **Add New -> Project**。
   - 选择您刚刚推送的 GitHub 仓库。
3. **配置环境变量**:
   - 在 Vercel 的 `Environment Variables` 设置中，添加以下 3 个变量：
     - `SUPABASE_URL`: `https://cduyshorxflblzhihrgo.supabase.co`
     - `SUPABASE_SERVICE_ROLE_KEY`: (从 Supabase Settings -> API 获取，**不要用** publishable 那个)
     - `GEMINI_API_KEY`: (您的 Google AI Key)
4. **部署**: 点击 **Deploy**。Vercel 会自动读取 `vercel.json` 并部署您的 Express 后端和 React 前端。

## 3. 安装与运行
```bash
# 安装依赖
npm install

# 构建前端
npm run build

# 启动服务器 (包含自动迁移逻辑)
npm start
```

## 4. 关键安全说明
- **API 密钥**: 用户的火山引擎 AK/SK 和二级 Gemini Key 存储在浏览器本地 `localStorage`，确保了您的主账号安全。
- **迁移逻辑**: 服务器启动时会自动检查 Supabase 数据库。如果为空，它会将您本地 `outputs/` 目录下的历史图片和数据自动上传到云端。
