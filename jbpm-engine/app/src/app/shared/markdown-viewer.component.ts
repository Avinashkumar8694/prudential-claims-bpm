import {
  Component,
  ElementRef,
  Input,
  OnInit,
  OnChanges,
  SimpleChanges,
  ViewChild,
  inject,
  PLATFORM_ID,
  AfterViewInit,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';
import mermaid from 'mermaid';

@Component({
  selector: 'app-markdown-viewer',
  standalone: true,
  template: `
    <div class="markdown-container" #container [innerHTML]="renderedHtml"></div>
  `,
  styles: [`
    .markdown-container {
      font-size: 13px;
      line-height: 1.6;
      color: var(--text, #1e293b);
      word-break: break-word;
    }
    :host ::ng-deep h1 {
      font-size: 20px;
      font-weight: 700;
      margin: 0 0 12px;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--border, #e2e8f0);
      color: var(--text-strong, #0f172a);
    }
    :host ::ng-deep h2 {
      font-size: 16px;
      font-weight: 600;
      margin: 20px 0 8px;
      color: var(--text-strong, #0f172a);
    }
    :host ::ng-deep h3 {
      font-size: 14px;
      font-weight: 600;
      margin: 14px 0 6px;
      color: var(--text-strong, #0f172a);
    }
    :host ::ng-deep p {
      margin: 0 0 10px;
    }
    :host ::ng-deep ul, :host ::ng-deep ol {
      margin: 0 0 12px;
      padding-left: 20px;
    }
    :host ::ng-deep li {
      margin-bottom: 4px;
    }
    :host ::ng-deep table {
      width: 100%;
      border-collapse: collapse;
      margin: 14px 0;
      font-size: 12px;
    }
    :host ::ng-deep th, :host ::ng-deep td {
      border: 1px solid var(--border, #e2e8f0);
      padding: 7px 10px;
      text-align: left;
    }
    :host ::ng-deep th {
      background: var(--surface-muted, #f8fafc);
      font-weight: 600;
    }
    :host ::ng-deep pre {
      background: var(--surface-code, #0f172a);
      color: #f8fafc;
      padding: 12px;
      border-radius: 8px;
      overflow-x: auto;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      margin: 10px 0;
    }
    :host ::ng-deep code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      background: var(--surface-muted, #f1f5f9);
      color: #0f172a;
      padding: 2px 5px;
      border-radius: 4px;
    }
    :host ::ng-deep pre code {
      background: transparent;
      color: inherit;
      padding: 0;
    }
    :host ::ng-deep blockquote {
      margin: 12px 0;
      padding: 8px 14px;
      border-left: 4px solid var(--primary, #3b82f6);
      background: var(--primary-50, #eff6ff);
      border-radius: 0 6px 6px 0;
      color: var(--text-muted, #334155);
    }
    :host ::ng-deep .mermaid-wrapper {
      margin: 16px 0;
      padding: 16px;
      background: var(--surface, #ffffff);
      border: 1px solid var(--border, #e2e8f0);
      border-radius: 8px;
      text-align: center;
      overflow-x: auto;
    }
    :host ::ng-deep .mermaid-wrapper svg {
      max-width: 100%;
      height: auto;
      margin: 0 auto;
    }
    :host ::ng-deep .copy-btn {
      float: right;
      font-size: 10px;
      padding: 2px 6px;
      border: 1px solid #475569;
      background: #1e293b;
      color: #cbd5e1;
      border-radius: 4px;
      cursor: pointer;
    }
    :host ::ng-deep .copy-btn:hover {
      background: #334155;
      color: #ffffff;
    }
  `],
})
export class MarkdownViewerComponent implements OnInit, OnChanges, AfterViewInit {
  @Input() content: string = '';
  @ViewChild('container') containerRef?: ElementRef<HTMLDivElement>;

  private sanitizer = inject(DomSanitizer);
  private platformId = inject(PLATFORM_ID);
  renderedHtml: SafeHtml = '';
  private mermaidInitialized = false;

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      try {
        mermaid.initialize({
          startOnLoad: false,
          theme: 'default',
          securityLevel: 'loose',
          fontFamily: 'inherit',
        });
        this.mermaidInitialized = true;
      } catch (e) {
        console.warn('Mermaid initialization error:', e);
      }
    }
  }

  ngOnInit(): void {
    if (this.content && !this.renderedHtml) {
      this.render();
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['content']) {
      this.render();
    }
  }

  ngAfterViewInit(): void {
    this.renderMermaidDiagrams();
  }

  private render(): void {
    if (!this.content) {
      this.renderedHtml = '';
      return;
    }

    try {
      // Pre-process markdown to format callouts & code blocks
      const processed = this.preprocessMarkdown(this.content);
      const parsed = marked.parse(processed, { async: false }) as string;
      this.renderedHtml = this.sanitizer.bypassSecurityTrustHtml(parsed);

      setTimeout(() => this.renderMermaidDiagrams(), 50);
    } catch (e) {
      this.renderedHtml = this.sanitizer.bypassSecurityTrustHtml(`<pre>${this.content}</pre>`);
    }
  }

  private preprocessMarkdown(md: string): string {
    // GitHub callout alerts: > [!NOTE] etc.
    return md
      .replace(/^>\s*\[!NOTE\]\s*(.*)$/gm, '> **Note**: $1')
      .replace(/^>\s*\[!TIP\]\s*(.*)$/gm, '> **Tip**: $1')
      .replace(/^>\s*\[!IMPORTANT\]\s*(.*)$/gm, '> **Important**: $1')
      .replace(/^>\s*\[!WARNING\]\s*(.*)$/gm, '> **Warning**: $1')
      .replace(/^>\s*\[!CAUTION\]\s*(.*)$/gm, '> **Caution**: $1');
  }

  private async renderMermaidDiagrams(): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || !this.mermaidInitialized || !this.containerRef) {
      return;
    }

    const container = this.containerRef.nativeElement;
    // Find all <pre><code class="language-mermaid"> blocks produced by marked
    const mermaidNodes = container.querySelectorAll('code.language-mermaid');
    if (!mermaidNodes.length) return;

    for (let i = 0; i < mermaidNodes.length; i++) {
      const node = mermaidNodes[i];
      const pre = node.parentElement;
      if (!pre || pre.getAttribute('data-mermaid-rendered') === 'true') continue;

      const code = node.textContent?.trim() || '';
      if (!code) continue;

      const uniqueId = `mermaid-svg-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 6)}`;
      try {
        const { svg } = await mermaid.render(uniqueId, code);
        const wrapper = document.createElement('div');
        wrapper.className = 'mermaid-wrapper';
        wrapper.innerHTML = svg;
        pre.replaceWith(wrapper);
        wrapper.setAttribute('data-mermaid-rendered', 'true');
      } catch (err) {
        console.warn('Failed to render mermaid diagram:', err);
        // Clean up temporary element created by mermaid if failed
        const tempEl = document.getElementById(uniqueId);
        if (tempEl) tempEl.remove();
      }
    }
  }
}
