import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CalendarDays, Newspaper, Tag } from 'lucide-react';
import { Button, Card, EmptyState } from '@/components/ui/ui';
import { POSTS, getPost } from './posts';
import { usePageMeta } from '@/lib/seo';

const fmtDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });

export function BlogPage() {
  usePageMeta('Blog — SIRAVEX', 'SIRAVEX blog: IPTV setup guides, HLS vs DASH explained, playback error codes decoded, and PWA install tips by Muaaz Iqbal.');
  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-sky-500/20 text-cyanx"><Newspaper size={22} aria-hidden /></span>
        <div><h1 className="text-xl font-extrabold sm:text-2xl">SIRAVEX Blog</h1><p className="text-sm text-muted">Guides, format explainers aur troubleshooting — kuch bhi fake nahi.</p></div>
      </div>
      <div className="grid gap-3">
        {POSTS.map((p) => (
          <Link key={p.slug} to={`/blog/${p.slug}`} className="group rounded-2xl border border-border bg-card p-4 transition hover:border-sky-500/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx sm:p-5">
            <p className="flex items-center gap-2 text-xs text-muted"><CalendarDays size={13} aria-hidden />{fmtDate(p.date)}<span className="inline-flex items-center gap-1">{p.tags.map((t) => <span key={t} className="rounded-full bg-panel px-2 py-0.5 text-[10px] font-semibold text-silver/80"><Tag size={9} className="mr-0.5 inline" aria-hidden />{t}</span>)}</span></p>
            <h2 className="mt-2 text-base font-extrabold group-hover:text-cyanx sm:text-lg">{p.title}</h2>
            <p className="mt-1 text-sm leading-6 text-muted">{p.description}</p>
            <span className="mt-2 inline-block text-sm font-semibold text-cyanx">Parhein →</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function BlogPostPage() {
  const { slug } = useParams();
  const post = slug ? getPost(slug) : undefined;
  usePageMeta(post ? `${post.title} — SIRAVEX Blog` : 'Blog — SIRAVEX', post?.description ?? 'SIRAVEX blog post.');
  if (!post) return <EmptyState title="Post not found" body="Ye blog post maujood nahi hai." action={<Link to="/blog"><Button>Saare posts</Button></Link>} />;
  return (
    <div className="mx-auto w-full max-w-3xl">
      <Link to="/blog" className="inline-flex min-h-[40px] items-center gap-1.5 text-sm font-semibold text-cyanx hover:underline"><ArrowLeft size={16} aria-hidden />Blog</Link>
      <article className="mt-2">
        <p className="flex items-center gap-2 text-xs text-muted"><CalendarDays size={13} aria-hidden />{fmtDate(post.date)} · Muaaz Iqbal</p>
        <h1 className="mt-2 text-2xl font-extrabold leading-tight sm:text-3xl">{post.title}</h1>
        <p className="mt-2 text-sm leading-6 text-muted sm:text-base">{post.description}</p>
        <Card className="mt-5">
          {post.body.map((block, i) => {
            if (block.startsWith('## ')) return <h2 key={i} className="mb-2 mt-5 text-base font-extrabold first:mt-0 sm:text-lg">{block.slice(3)}</h2>;
            if (block.startsWith('- ')) return <p key={i} className="mb-1.5 pl-4 text-sm leading-6 text-silver/90 sm:text-[15px]">• {block.slice(2)}</p>;
            return <p key={i} className="mb-3 text-sm leading-7 text-silver/90 sm:text-[15px]">{block}</p>;
          })}
        </Card>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link to="/"><Button>SIRAVEX kholein</Button></Link>
          <Link to="/blog"><Button variant="outline">Aur posts parhein</Button></Link>
        </div>
      </article>
    </div>
  );
}
