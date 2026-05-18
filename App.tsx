import { useState, useEffect, useRef } from 'react';
import { 
  Plus, 
  Upload, 
  Sparkles, 
  Image as ImageIcon, 
  Copy, 
  Check, 
  Trash2, 
  LayoutGrid, 
  Zap, 
  Settings, 
  X, 
  Maximize2, 
  RefreshCw,
  Download,
  FileText,
  Clock,
  ExternalLink,
  ChevronRight,
  Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import axios from 'axios';

// --- Types ---
interface PromptData {
  model: string;
  subject: string;
  style: string;
  raw: string;
}

interface GalleryItem {
  id: string;
  image_url: string;
  txt_mtime: number;
  prompt: PromptData;
  date?: string;
}

interface Model {
  id: string;
  label: string;
}

interface BatchPrompt {
  id: number;
  text: string;
}

// --- Components ---

const Badge = ({ children, status }: { children: React.ReactNode; status: 'ok' | 'err' | 'warn' | 'idle' }) => {
  const styles = {
    ok: 'border-success text-success bg-success-bg',
    err: 'border-danger text-danger bg-danger-bg',
    warn: 'border-warning text-warning bg-warning-bg',
    idle: 'border-text-ghost text-text-dim bg-bg-alt',
  };
  return (
    <span className={`text-[11px] px-2.5 py-0.5 rounded-full border transition-colors ${styles[status]}`}>
      {children}
    </span>
  );
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'workspace' | 'batch' | 'gallery'>('workspace');
  const [backendStatus, setBackendStatus] = useState<'ok' | 'err' | 'idle'>('idle');
  const [models, setModels] = useState<Model[]>([]);
  const [selectedReverseModel, setSelectedReverseModel] = useState('');
  const [statusMsg, setStatusMsg] = useState('就绪 — 请上传参考图开始');
  const [statusType, setStatusType] = useState<'ok' | 'err' | 'loading' | 'idle'>('idle');
  
  // Workspace State
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [extraHint, setExtraHint] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [imagePrompt, setImagePrompt] = useState('');
  const [isReversing, setIsReversing] = useState(false);
  const [genImageUrl, setGenImageUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [usedModel, setUsedModel] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Batch State
  const [batchSysPrompt, setBatchSysPrompt] = useState('');
  const [batchTheme, setBatchTheme] = useState('');
  const [batchCount, setBatchCount] = useState(20);
  const [batchModel, setBatchModel] = useState('gemini-3.1-pro-preview');
  const [batchResults, setBatchResults] = useState<string[]>([]);
  const [isBatchGenerating, setIsBatchGenerating] = useState(false);

  // Gallery State
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [selectedGalleryItem, setSelectedGalleryItem] = useState<GalleryItem | null>(null);

  // Modal State
  const [showConfig, setShowConfig] = useState(false);

  // Fetch initial data
  useEffect(() => {
    fetchModels();
    fetchGallery();
    const interval = setInterval(fetchGallery, 3000);
    return () => clearInterval(interval);
  }, []);

  const fetchModels = async () => {
    try {
      const res = await axios.get('/api/models');
      setModels(res.data.models);
      if (res.data.models.length > 0) setSelectedReverseModel(res.data.models[0].id);
      setBackendStatus('ok');
    } catch (err) {
      setBackendStatus('err');
    }
  };

  const fetchGallery = async () => {
    try {
      const res = await axios.get('/api/gallery');
      if (res.data.status === 'success') {
        setGallery(res.data.items);
      }
    } catch (err) {
      console.error('Gallery sync failed');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    setFile(selectedFile);
    setPreviewUrl(URL.createObjectURL(selectedFile));
    setStatusMsg('图片已上传，点击「AI 反推」开始解析');
    setStatusType('ok');
  };

  const doReverseDraft = async () => {
    if (!file) return;
    setIsReversing(true);
    setStatusMsg('Gemini 正在深度解析画风中...');
    setStatusType('loading');

    const fd = new FormData();
    fd.append('file', file);
    fd.append('model', selectedReverseModel);
    fd.append('extra_hint', extraHint);

    try {
      const res = await axios.post('/api/reverse-prompt', fd);
      if (res.data.status === 'success') {
        setSystemPrompt(res.data.data.system_prompt);
        setImagePrompt(res.data.data.image_prompt);
        setUsedModel(res.data.model_used);
        setStatusMsg('解析成功 ✓ 现在可以开始生图测试');
        setStatusType('ok');
      } else {
        throw new Error(res.data.message);
      }
    } catch (err: any) {
      setStatusMsg(`解析失败: ${err.message}`);
      setStatusType('err');
    } finally {
      setIsReversing(false);
    }
  };

  const doBananaGenerate = async () => {
    setIsGenerating(true);
    setGenImageUrl(null);
    setStatusMsg('Gemini 香蕉生图中 (约15-60秒)...');
    setStatusType('loading');

    try {
      const res = await axios.post('/api/banana-generate', {
        prompt: imagePrompt,
        banana_model: 'gemini-3.1-flash-image-preview',
        aspect_ratio: '9:16',
        image_size: '1K'
      });
      if (res.data.status === 'success') {
        setGenImageUrl(`data:image/png;base64,${res.data.image_b64}`);
        setStatusMsg('生图成功 ✓ 已自动保存至本地');
        setStatusType('ok');
        fetchGallery();
      } else {
        throw new Error(res.data.message);
      }
    } catch (err: any) {
      setStatusMsg(`生图失败: ${err.message}`);
      setStatusType('err');
    } finally {
      setIsGenerating(false);
    }
  };

  const doBatchGenerate = async () => {
    if (!batchSysPrompt || !batchTheme) return;
    setIsBatchGenerating(true);
    setBatchResults([]);
    
    try {
      const res = await axios.post('/api/batch-prompts', {
        system_prompt: batchSysPrompt,
        theme: batchTheme,
        count: batchCount,
        model: batchModel
      });
      if (res.data.status === 'success') {
        setBatchResults(res.data.prompts);
      } else {
        throw new Error(res.data.message);
      }
    } catch (err: any) {
      console.error('Batch error:', err);
    } finally {
      setIsBatchGenerating(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const loadItemToWorkspace = (item: GalleryItem) => {
    setSystemPrompt(item.prompt.style || '');
    setImagePrompt(item.prompt.subject || '');
    setGenImageUrl(item.image_url);
    setActiveTab('workspace');
    setStatusMsg('已从画廊加载案例到工作台');
    setStatusType('ok');
  };

  return (
    <div className="flex flex-col min-h-screen bg-bg text-text">
      {/* Navigation */}
      <nav className="flex items-center justify-between px-7 h-14 bg-bg-alt border-bottom border-border sticky top-0 z-50">
        <div className="flex items-center gap-2 font-display font-semibold text-sm tracking-widest">
          <div className="w-5.5 h-5.5 rounded-md bg-accent flex items-center justify-center text-[10px]">✦</div>
          AI PROMPT WORKBENCH
        </div>
        <div className="flex gap-1 bg-bg-card p-0.5 rounded-lg border border-border">
          {(['workspace', 'batch', 'gallery'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${
                activeTab === tab ? 'bg-bg-hover text-text' : 'text-text-dim hover:text-text'
              }`}
            >
              {tab === 'workspace' ? '生图工作台' : tab === 'batch' ? '⚡ 批量生成' : '案例画廊'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <Badge status={backendStatus === 'ok' ? 'ok' : 'err'}>
            {backendStatus === 'ok' ? '后端已连接' : '连接失败'}
          </Badge>
          <button 
            onClick={() => setShowConfig(true)}
            className="p-1.5 rounded-md bg-bg-card border border-border text-text-dim hover:text-text transition-colors"
          >
            <Settings size={14} />
          </button>
        </div>
      </nav>

      <main className="flex-1 p-6 overflow-y-auto">
        <AnimatePresence mode="wait">
          {activeTab === 'workspace' && (
            <motion.div 
              key="workspace"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6 max-w-7xl mx-auto"
            >
              {/* Progress Bar */}
              <div className="flex items-center gap-4">
                <span className="text-[11px] text-text-dim uppercase tracking-widest">Pipeline</span>
                <div className="flex-1 flex gap-1.5 h-0.5 bg-border rounded-full overflow-hidden">
                  <div className={`flex-1 ${previewUrl ? 'bg-success' : 'bg-accent'}`} />
                  <div className={`flex-1 ${systemPrompt ? 'bg-success' : previewUrl ? 'bg-accent' : 'bg-border'}`} />
                  <div className={`flex-1 ${genImageUrl ? 'bg-success' : systemPrompt ? 'bg-accent' : 'bg-border'}`} />
                  <div className={`flex-1 ${statusType === 'ok' && genImageUrl ? 'bg-success' : 'bg-border'}`} />
                </div>
                <span className="text-[11px] text-text-dim font-mono">{statusMsg}</span>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6 items-start">
                {/* Left Panel: Upload & Config */}
                <div className="space-y-4">
                  <div className="bg-bg-card border border-border rounded-xl p-4 space-y-4 shadow-xl">
                    <h3 className="text-[11px] font-mono text-text-dim uppercase tracking-widest">Image Source</h3>
                    <div 
                      onClick={() => fileInputRef.current?.click()}
                      className="aspect-[4/5] bg-bg-alt border-2 border-dashed border-border-bright rounded-lg overflow-hidden group cursor-pointer hover:border-accent hover:bg-accent-glow transition-all flex flex-col items-center justify-center p-4 text-center"
                    >
                      {previewUrl ? (
                        <img src={previewUrl} className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                      ) : (
                        <>
                          <div className="w-10 h-10 rounded-full bg-bg-hover flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                            <Upload size={20} className="text-text-dim" />
                          </div>
                          <p className="text-xs font-medium mb-1">点击上传参考图</p>
                          <p className="text-[10px] text-text-ghost">JPG / PNG · 最大 15MB</p>
                        </>
                      )}
                      <input ref={fileInputRef} type="file" className="hidden" accept="image/*" onChange={handleFileUpload} />
                    </div>

                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <label className="text-[10px] text-text-dim uppercase tracking-tighter">Vision Analytics</label>
                        <select 
                          value={selectedReverseModel}
                          onChange={(e) => setSelectedReverseModel(e.target.value)}
                          className="w-full bg-bg-alt border border-border rounded-md px-3 py-2 text-xs outline-none focus:border-accent"
                        >
                          {models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                          {models.length === 0 && <option>加载中...</option>}
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] text-text-dim uppercase tracking-tighter">Extra Context</label>
                        <textarea 
                          value={extraHint}
                          onChange={(e) => setExtraHint(e.target.value)}
                          placeholder="例如: 极简主义, 厚涂风格..."
                          className="w-full bg-bg-alt border border-border rounded-md px-3 py-2 text-xs outline-none focus:border-accent resize-none h-16"
                        />
                      </div>
                      <button 
                        disabled={!file || isReversing}
                        onClick={doReverseDraft}
                        className="w-full py-2.5 bg-accent hover:bg-accent-bright disabled:opacity-30 rounded-lg text-xs font-semibold shadow-lg shadow-accent-glow transition-all flex items-center justify-center gap-2"
                      >
                        {isReversing ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
                        {isReversing ? '分析中...' : '✦ AI 逆向反推'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Right Panel: Prompts & Output */}
                <div className="space-y-5">
                  <div className="bg-bg-card border border-border rounded-xl p-4 shadow-xl">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-[11px] font-mono text-text-dim uppercase tracking-widest">Logic & Structure</h3>
                      {usedModel && (
                        <div className="text-[10px] bg-accent-glow text-accent-bright border border-accent/20 px-2 py-0.5 rounded-full">
                          ✦ {usedModel}
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] text-text-dim uppercase font-semibold">System Prompt</label>
                          <button onClick={() => copyToClipboard(systemPrompt)} className="p-1 text-text-dim hover:text-text transition-colors">
                            <Copy size={12} />
                          </button>
                        </div>
                        <textarea 
                          value={systemPrompt}
                          onChange={(e) => setSystemPrompt(e.target.value)}
                          className="w-full h-56 bg-bg-alt border border-border rounded-lg p-3 text-xs font-mono leading-relaxed outline-none focus:border-accent resize-none"
                          placeholder="系统指令将在此显示..."
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] text-text-dim uppercase font-semibold">Image Prompt</label>
                          <button onClick={() => copyToClipboard(imagePrompt)} className="p-1 text-text-dim hover:text-text transition-colors">
                            <Copy size={12} />
                          </button>
                        </div>
                        <textarea 
                          value={imagePrompt}
                          onChange={(e) => setImagePrompt(e.target.value)}
                          className="w-full h-56 bg-bg-alt border border-border rounded-lg p-3 text-xs font-mono leading-relaxed outline-none focus:border-accent resize-none"
                          placeholder="画面描述将在此显示..."
                        />
                      </div>
                    </div>
                  </div>

                  {/* Output Preview */}
                  <div className="bg-bg-card border border-border rounded-xl p-4 shadow-xl">
                    <h3 className="text-[11px] font-mono text-text-dim uppercase tracking-widest mb-4">Generation Artifact</h3>
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_200px] gap-6">
                      <div className="relative aspect-video md:aspect-[21/9] bg-bg-alt border border-border-bright rounded-xl overflow-hidden flex items-center justify-center group">
                        {genImageUrl ? (
                          <img src={genImageUrl} className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                        ) : (
                          <div className="flex flex-col items-center gap-3 text-text-dim">
                            <ImageIcon size={32} className="opacity-20" />
                            <span className="text-[10px] font-mono uppercase tracking-widest opacity-40">Waiting for production</span>
                          </div>
                        )}
                        {isGenerating && (
                          <div className="absolute inset-0 bg-bg/60 backdrop-blur-sm flex flex-col items-center justify-center gap-4">
                            <div className="flex gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-accent animate-bounce [animation-delay:-0.3s]"></span>
                              <span className="w-2 h-2 rounded-full bg-accent animate-bounce [animation-delay:-0.15s]"></span>
                              <span className="w-2 h-2 rounded-full bg-accent animate-bounce"></span>
                            </div>
                            <span className="text-[11px] font-mono uppercase tracking-tighter animate-pulse text-accent-bright">Synthesizing Imagery</span>
                          </div>
                        )}
                      </div>
                      
                      <div className="flex flex-col gap-3">
                        <div className="p-3 rounded-lg bg-bg-alt border border-border space-y-2">
                          <p className="text-[9px] text-text-ghost font-bold uppercase tracking-widest">Imagen Engine</p>
                          <button 
                            disabled={!imagePrompt || isGenerating}
                            onClick={doBananaGenerate}
                            className="w-full py-2 bg-amber-bg text-amber border border-amber/20 hover:bg-amber/20 transition-all rounded-md text-[11px] font-bold flex items-center justify-center gap-2"
                          >
                            <Zap size={14} />
                            香蕉生图 (Gemini)
                          </button>
                        </div>
                        <button 
                          disabled={!genImageUrl}
                          className="w-full py-2 bg-green-bg text-success border border-success/20 hover:bg-success/20 transition-all rounded-md text-[11px] font-bold flex items-center justify-center gap-2"
                        >
                          <Download size={14} />
                          保存至画廊
                        </button>
                        <div className="flex-1" />
                        <button 
                          onClick={() => {
                            setFile(null); setPreviewUrl(null); setSystemPrompt(''); setImagePrompt(''); setGenImageUrl(null);
                          }}
                          className="w-full py-2 bg-bg-alt border border-border text-text-ghost hover:text-text hover:border-text-ghost transition-all rounded-md text-[11px] uppercase tracking-widest"
                        >
                          Clear Workspace
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer Status */}
              <footer className="flex items-center gap-3 p-3 bg-bg-card border border-border rounded-lg text-xs">
                <div className={`w-2 h-2 rounded-full ${
                  statusType === 'loading' ? 'bg-accent animate-pulse' :
                  statusType === 'ok' ? 'bg-success' :
                  statusType === 'err' ? 'bg-danger' : 'bg-text-ghost'
                }`} />
                <span className="text-text-dim">{statusMsg}</span>
              </footer>
            </motion.div>
          )}

          {activeTab === 'batch' && (
            <motion.div 
              key="batch"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6 items-start"
            >
              <div className="space-y-4">
                <div className="bg-bg-card border border-border rounded-xl p-5 space-y-4 shadow-xl">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[11px] font-mono text-text-dim uppercase tracking-widest">Batch Blueprint</h3>
                    <button 
                      onClick={() => setBatchSysPrompt(systemPrompt)}
                      className="text-[10px] text-accent hover:text-accent-bright underline"
                    >
                      从工作台导入指令
                    </button>
                  </div>
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] text-text-dim uppercase tracking-tighter">System Instruction</label>
                      <textarea 
                        value={batchSysPrompt}
                        onChange={(e) => setBatchSysPrompt(e.target.value)}
                        placeholder="粘贴 SYSTEM_CHARACTER 代码块..."
                        className="w-full h-64 bg-bg-alt border border-border rounded-lg p-3 text-xs font-mono outline-none focus:border-accent resize-vertical"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] text-text-dim uppercase tracking-tighter">Theme / Topic</label>
                      <input 
                        value={batchTheme}
                        onChange={(e) => setBatchTheme(e.target.value)}
                        placeholder="例如: 20个春祭和服少女场景..."
                        className="w-full bg-bg-alt border border-border rounded-md px-3 py-2 text-xs outline-none focus:border-accent"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-[10px] text-text-dim uppercase tracking-tighter">Quantity</label>
                        <select 
                          value={batchCount}
                          onChange={(e) => setBatchCount(Number(e.target.value))}
                          className="w-full bg-bg-alt border border-border rounded-md px-3 py-2 text-xs outline-none"
                        >
                          <option value={10}>10 条</option>
                          <option value={20}>20 条</option>
                          <option value={30}>30 条</option>
                          <option value={50}>50 条</option>
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] text-text-dim uppercase tracking-tighter">Model</label>
                        <select 
                          value={batchModel}
                          onChange={(e) => setBatchModel(e.target.value)}
                          className="w-full bg-bg-alt border border-border rounded-md px-3 py-2 text-xs outline-none"
                        >
                          <option value="gemini-3.1-pro-preview">Pro (High Quality)</option>
                          <option value="gemini-3-flash-preview">Flash (Fast)</option>
                        </select>
                      </div>
                    </div>
                    <button 
                      disabled={!batchSysPrompt || !batchTheme || isBatchGenerating}
                      onClick={doBatchGenerate}
                      className="w-full py-3 bg-accent hover:bg-accent-bright disabled:opacity-30 rounded-lg text-sm font-bold shadow-lg transition-all flex items-center justify-center gap-2"
                    >
                      {isBatchGenerating ? <Loader2 className="animate-spin" size={18} /> : <Zap size={18} />}
                      {isBatchGenerating ? '批量合生中...' : '⚡ 开始批量生成'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-[11px] font-mono text-text-dim uppercase tracking-widest">Generation Streams</h3>
                  <Badge status="idle">{batchResults.length} 条已生成</Badge>
                </div>
                
                <div className="space-y-3 max-h-[calc(100vh-200px)] overflow-y-auto pr-2">
                  {batchResults.length === 0 ? (
                    <div className="h-64 flex flex-col items-center justify-center border border-dashed border-border rounded-2xl text-text-ghost gap-4">
                      <FileText size={40} className="opacity-10" />
                      <p className="text-xs uppercase tracking-widest font-mono">Empty Result Stream</p>
                    </div>
                  ) : (
                    batchResults.map((prompt, idx) => (
                      <motion.div 
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        key={idx}
                        className="bg-bg-card border border-border rounded-xl p-4 space-y-3 group hover:border-accent/40 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-mono text-accent font-bold">BLOCK::{String(idx + 1).padStart(3, '0')}</span>
                          <div className="flex gap-2">
                            <button onClick={() => copyToClipboard(prompt)} className="p-1.5 rounded-md bg-bg-alt border border-border text-text-dim hover:text-text transition-colors">
                              <Copy size={12} />
                            </button>
                            <button 
                              onClick={() => {
                                setImagePrompt(prompt);
                                setBatchSysPrompt(batchSysPrompt);
                                setSystemPrompt(batchSysPrompt);
                                setActiveTab('workspace');
                              }}
                              className="px-2 py-1 rounded-md bg-accent-glow text-accent-bright border border-accent/20 text-[10px] font-bold"
                            >
                              加载到工作台
                            </button>
                          </div>
                        </div>
                        <p className="text-xs text-text-dim leading-relaxed font-mono">{prompt}</p>
                      </motion.div>
                    ))
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'gallery' && (
            <motion.div 
              key="gallery"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="max-w-7xl mx-auto space-y-6"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-display font-bold tracking-tight">案例画廊</h2>
                  <p className="text-xs text-text-dim">所有本地存储的生成历史</p>
                </div>
                <div className="px-4 py-1.5 bg-bg-card border border-border rounded-full text-xs font-mono">
                  {gallery.length} ARTIFACTS
                </div>
              </div>

              {gallery.length === 0 ? (
                <div className="h-96 flex flex-col items-center justify-center border-2 border-dashed border-border rounded-3xl gap-4">
                  <ImageIcon size={64} className="text-text-ghost opacity-20" />
                  <p className="text-text-ghost font-mono uppercase tracking-[0.2em]">Zero artifacts found</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                  {gallery.map((item, idx) => (
                    <motion.div 
                      key={item.id}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: idx * 0.05 }}
                      onClick={() => setSelectedGalleryItem(item)}
                      className="group relative aspect-[3/4] bg-bg-card rounded-xl border border-border overflow-hidden cursor-pointer hover:border-accent transition-all hover:-translate-y-1"
                    >
                      <img src={item.image_url} className="w-full h-full object-cover grayscale-[0.2] group-hover:grayscale-0 transition-all duration-500" referrerPolicy="no-referrer" />
                      <div className="absolute inset-0 bg-gradient-to-t from-bg/90 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-all flex flex-col justify-end p-4">
                        <p className="text-xs font-bold truncate">{item.prompt.subject.split('\n')[0]}</p>
                        <div className="flex items-center gap-2 mt-2">
                           <span className="text-[10px] text-text-dim flex items-center gap-1">
                             <Clock size={10} /> {new Date(item.txt_mtime).toLocaleDateString()}
                           </span>
                           <span className="text-[10px] text-accent uppercase font-mono">{item.id}</span>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Gallery Detail Modal */}
      <AnimatePresence>
        {selectedGalleryItem && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-bg/80 backdrop-blur-xl">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-bg-card border border-border-bright rounded-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col lg:flex-row shadow-2xl"
            >
              <div className="lg:w-1/2 p-6 bg-bg-alt flex flex-col items-center justify-center">
                <div className="w-full aspect-[3/4] rounded-lg overflow-hidden border border-border">
                   <img src={selectedGalleryItem.image_url} className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                </div>
                <div className="w-full mt-4 flex gap-2">
                   <button className="flex-1 py-2 bg-bg-hover border border-border rounded-md text-xs font-bold">Download PNG</button>
                   <button onClick={() => setSelectedGalleryItem(null)} className="p-2 bg-danger-bg text-danger border border-danger/20 rounded-md"><Trash2 size={16} /></button>
                </div>
              </div>
              <div className="flex-1 p-8 flex flex-col gap-6 overflow-y-auto">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-2xl font-display font-bold">Artifact Study</h2>
                    <p className="text-xs text-text-dim font-mono mt-1">ID:: {selectedGalleryItem.id} | Timestamp: {new Date(selectedGalleryItem.txt_mtime).toLocaleString()}</p>
                  </div>
                  <button onClick={() => setSelectedGalleryItem(null)} className="p-2 hover:bg-bg-hover rounded-full transition-colors"><X size={20} /></button>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-[10px] text-text-dim uppercase tracking-widest font-bold">Synthesized Subject</label>
                    <div className="bg-bg-alt border border-border rounded-lg p-4 text-[13px] leading-relaxed font-mono">
                      {selectedGalleryItem.prompt.subject}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] text-text-dim uppercase tracking-widest font-bold">System Framework (Style)</label>
                    <div className="bg-bg-alt border border-border rounded-lg p-4 text-[11px] leading-relaxed font-mono opacity-60">
                      {selectedGalleryItem.prompt.style}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-6 pt-6 border-t border-border">
                    <button 
                      onClick={() => loadItemToWorkspace(selectedGalleryItem)}
                      className="flex-1 py-3 bg-accent hover:bg-accent-bright rounded-xl text-sm font-bold flex items-center justify-center gap-2"
                    >
                      <Zap size={18} />
                      加载并进入工作台
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Config Modal */}
      <AnimatePresence>
        {showConfig && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-bg/90 backdrop-blur-md p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-bg-card border border-border-bright rounded-2xl p-7 w-full max-w-md shadow-2xl space-y-6"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-accent-glow text-accent-bright"><Settings size={20} /></div>
                  <h2 className="text-lg font-bold">Node.js API 配置</h2>
                </div>
                <button onClick={() => setShowConfig(false)} className="p-1 text-text-ghost hover:text-text"><X size={20} /></button>
              </div>
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-bg-alt border border-border space-y-1.5">
                   <p className="text-[11px] text-text-dim font-bold uppercase tracking-widest">Environment Setup</p>
                   <p className="text-xs text-text-ghost leading-relaxed">
                     Gemini Key 已自动注入。若需激活 **火山引擎 (即梦)** 接口，请在 <code className="text-accent-bright">.env</code> 中配置 <code className="text-accent-bright">VOLC_AK</code> 和 <code className="text-accent-bright">VOLC_SK</code>。
                   </p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] text-text-dim uppercase font-bold tracking-widest">Active Backend Node</label>
                  <div className="flex items-center gap-2 px-3 py-2 bg-bg-hover rounded-md border border-border">
                    <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                    <span className="text-xs font-mono">http://localhost:3000</span>
                  </div>
                </div>
                <div className="space-y-1.5">
                   <label className="text-[10px] text-text-dim uppercase font-bold tracking-widest">Artifacts Strategy</label>
                   <div className="flex items-center gap-2 px-3 py-2 bg-bg-hover rounded-md border border-border">
                    <span className="text-xs font-mono">Local Workspace (./outputs)</span>
                  </div>
                </div>
              </div>
              <button onClick={() => setShowConfig(false)} className="w-full py-3 bg-accent hover:bg-accent-bright rounded-xl text-sm font-bold">
                确认并返回项目
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
