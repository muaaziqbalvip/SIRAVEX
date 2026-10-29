import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, Clock3 } from 'lucide-react';
import { Button, Card, EmptyState } from '@/components/ui/ui';
import { GUIDES, GUIDE_CATEGORIES, getGuide } from './guides';
import { usePageMeta } from '@/lib/seo';

const CAT_COLORS: Record<string, string> = { Setup: 'bg-sky-500/20 text-sky-300', Watching: 'bg-violet-500/20 text-violet-300', Install: 'bg-emerald-500/20 text-emerald-300', Help: 'bg-amber-500/20 text-amber-300' };

export function GuidesPage() {
  usePageMeta('Guides — SIRAVEX Help Center', 'Every SIRAVEX guide: installation on Android, iPhone, desktop and Smart TV, playlist & Xtream setup, player mastery, EPG, troubleshooting and privacy — by Muaaz Iqbal.');
  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-sky-500/20 text-cyanx"><BookOpen size={22} aria-hidden /></span>
        <div><h1 className="text-xl font-extrabold sm:text-2xl">SIRAVEX Guides — Help Center</h1><p className="text-sm text-muted">Install, setup, player aur masail — har cheez ki step-by-step guide.</p></div>
      </div>
      {GUIDE_CATEGORIES.map((cat) => (
        <section key={cat} aria-label={`${cat} guides`} className="mb-6">
          <h2 className="mb-2 text-base font-extrabold">{cat === 'Setup' ? '🚀 Setup' : cat === 'Watching' ? '▶️ Watching' : cat === 'Install' ? '📲 Install' : '🛠 Help'} Guides</h2>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {GUIDES.filter((g) => g.category === cat).map((g) => (
              <Link key={g.slug} to={`/guides/${g.slug}`} className="group rounded-2xl border border-border bg-card p-4 transition hover:border-sky-500/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx">
                <p className="flex items-center gap-2 text-[11px] text-muted"><span className={`rounded-full px-2 py-0.5 font-bold ${CAT_COLORS[g.category]}`}>{g.category}</span><span className="inline-flex items-center gap-1"><Clock3 size={11} aria-hidden />{g.minutes} min</span></p>
                <h3 className="mt-2 font-extrabold leading-snug group-hover:text-cyanx">{g.title}</h3>
                <p className="mt-1 text-sm leading-6 text-muted">{g.description}</p>
              </Link>
            ))}
          </div>
        </section>
      ))}
      <Card className="text-center">
        <p className="text-sm leading-6 text-muted">Aur parhna hai? <Link to="/blog" className="font-semibold text-cyanx hover:underline">SIRAVEX Blog</Link> par gehri guides aur developer ki kahaniyan milengi.</p>
      </Card>
    </div>
  );
}

export function GuidePage() {
  const { slug } = useParams();
  const guide = slug ? getGuide(slug) : undefined;
  usePageMeta(guide ? `${guide.title} — SIRAVEX Guides` : 'Guides — SIRAVEX', guide?.description ?? 'SIRAVEX guide.');
  if (!guide) return <EmptyState title="Guide not found" body="Ye guide maujood nahi hai." action={<Link to="/guides"><Button>Saari guides</Button></Link>} />;
  const others = GUIDES.filter((g) => g.slug !== guide.slug && g.category === guide.category).slice(0, 3);
  return (
    <div className="mx-auto w-full max-w-3xl">
      <Link to="/guides" className="inline-flex min-h-[40px] items-center gap-1.5 text-sm font-semibold text-cyanx hover:underline"><ArrowLeft size={16} aria-hidden />Guides</Link>
      <article className="mt-2">
        <p className="text-xs text-muted"><span className={`rounded-full px-2 py-0.5 font-bold ${CAT_COLORS[guide.category]}`}>{guide.category}</span> · {guide.minutes} min read · Muaaz Iqbal</p>
        <h1 className="mt-2 text-2xl font-extrabold leading-tight sm:text-3xl">{guide.title}</h1>
        <p className="mt-2 text-sm leading-6 text-muted sm:text-base">{guide.description}</p>
        <Card className="mt-5">
          {guide.body.map((block, i) => {
            if (block.startsWith('## ')) return <h2 key={i} className="mb-2 mt-5 text-base font-extrabold first:mt-0 sm:text-lg">{block.slice(3)}</h2>;
            if (block.startsWith('- ')) return <p key={i} className="mb-1.5 pl-4 text-sm leading-6 text-silver/90 sm:text-[15px]">• {block.slice(2)}</p>;
            return <p key={i} className="mb-3 text-sm leading-7 text-silver/90 sm:text-[15px]">{block}</p>;
          })}
        </Card>
        {others.length > 0 && (
          <div className="mt-5">
            <h2 className="mb-2 text-sm font-extrabold uppercase tracking-wide text-muted">Isi qisam ki aur guides</h2>
            <div className="grid gap-2 sm:grid-cols-3">{others.map((g) => <Link key={g.slug} to={`/guides/${g.slug}`} className="rounded-xl border border-border bg-card p-3 text-sm font-semibold hover:border-sky-500/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx">{g.title}</Link>)}</div>
          </div>
        )}
      </article>
    </div>
  );
}
