import React, { useState } from 'react';
import { useApp } from '../App';

const TEMPLATES = {
  '✍️ Writing': [
    { title: 'Professional email', desc: 'Compose a polished email for any situation', prompt: 'Help me write a professional email. Here\'s the context: [describe the situation]. Keep it polite, clear, and concise.' },
    { title: 'Thank you note', desc: 'Express gratitude beautifully', prompt: 'Write a heartfelt thank you note for [person] who [what they did]. Make it warm and personal.' },
    { title: 'Social media post', desc: 'Engaging posts for any platform', prompt: 'Write an engaging social media post about [topic]. Make it catchy, include relevant hashtags, and keep it under 280 characters for Twitter or longer for LinkedIn.' },
    { title: 'Cover letter', desc: 'Stand out in your job application', prompt: 'Write a compelling cover letter for a [job title] position at [company]. My key strengths are [list strengths]. Make it professional but show personality.' },
    { title: 'Blog post', desc: 'Long-form content that engages', prompt: 'Write a blog post about [topic]. Include an attention-grabbing intro, 3-4 key sections with subheadings, and a strong conclusion. Aim for 800-1000 words.' },
  ],
  '🎓 Learning': [
    { title: 'Explain like I\'m 5', desc: 'Any topic, made simple', prompt: 'Explain [topic] to me like I\'m 5 years old. Use simple analogies, fun examples, and break it down step by step.' },
    { title: 'Interactive quiz', desc: 'Test your knowledge on any topic', prompt: 'Create a 10-question quiz about [topic] with increasing difficulty. Ask one question at a time, wait for my answer, then tell me if I\'m right and explain why.' },
    { title: 'Study notes', desc: 'Comprehensive study guide', prompt: 'Create comprehensive study notes for [topic/chapter]. Include key concepts, definitions, examples, and memory aids. Format with clear headings.' },
    { title: 'Debate both sides', desc: 'Understand any argument fully', prompt: 'Present both sides of the debate on [topic]. Give the strongest arguments for each side, with evidence and examples. Then summarize the nuances.' },
    { title: 'Language lesson', desc: 'Learn phrases in any language', prompt: 'Teach me 20 essential phrases in [language] for [situation: traveling/business/daily life]. Include pronunciation guides and cultural context.' },
  ],
  '🎮 Creative & Fun': [
    { title: 'Build me a game', desc: 'A playable game in your browser', prompt: 'Build me a fun, visually polished browser game. Make it interactive with score tracking, animations, and a restart button. Surprise me with the concept!' },
    { title: 'Tell me a story', desc: 'Custom fiction just for you', prompt: 'Write me a short story in the genre of [sci-fi/fantasy/mystery/romance]. Make it vivid, with compelling characters and an unexpected twist.' },
    { title: 'Generate a website', desc: 'A complete page in seconds', prompt: 'Create a beautiful, modern landing page for [a coffee shop/portfolio/startup/event]. Make it responsive with smooth animations.' },
    { title: 'Draw with code', desc: 'SVG art and visualizations', prompt: 'Create a beautiful SVG artwork of [a sunset/mountain landscape/abstract art/space scene]. Make it colorful and detailed using pure SVG.' },
    { title: 'Recipe ideas', desc: 'Cook something amazing', prompt: 'I have these ingredients: [list ingredients]. Suggest 3 creative recipes I can make, with step-by-step instructions and estimated cooking times.' },
  ],
  '💼 Productivity': [
    { title: 'Meeting summary', desc: 'Turn notes into action items', prompt: 'I\'ll paste my meeting notes. Please organize them into: 1) Key decisions made, 2) Action items with owners, 3) Open questions, 4) Next steps.' },
    { title: 'Project plan', desc: 'Break down any project', prompt: 'Help me create a project plan for [project]. Break it into phases, estimate timelines, identify risks, and suggest milestones.' },
    { title: 'Pros & cons analysis', desc: 'Make better decisions', prompt: 'Help me analyze this decision: [describe decision]. List the pros and cons, rate each on importance (1-5), and give me a recommendation.' },
    { title: 'Weekly planner', desc: 'Organize your week', prompt: 'Help me plan my week. My priorities are: [list priorities]. My available hours are [hours]. Create a day-by-day schedule that balances productivity and rest.' },
    { title: 'Competitor analysis', desc: 'Research your market', prompt: 'Do a competitor analysis for [my product/company] in the [industry] space. Research key competitors, their strengths/weaknesses, and opportunities for differentiation.' },
  ],
  '🔬 Research & Analysis': [
    { title: 'Deep dive', desc: 'Thorough research on any topic', prompt: 'Do deep research on [topic]. Cover the history, current state, key players, recent developments, and future outlook. Include source references.' },
    { title: 'Data explainer', desc: 'Make sense of numbers', prompt: 'I\'ll share some data/statistics. Please analyze it, identify trends, explain what it means in plain English, and suggest what to do next.' },
    { title: 'Book summary', desc: 'Key takeaways from any book', prompt: 'Give me a comprehensive summary of the book "[book title]" by [author]. Include the main thesis, key arguments, notable examples, and practical takeaways.' },
    { title: 'Fact check', desc: 'Verify claims with evidence', prompt: 'Fact-check this claim: "[claim]". Search for evidence for and against it, cite your sources, and give a verdict.' },
  ],
};

export default function Templates() {
  const { setPage, bridge } = useApp();
  const [selectedCategory, setSelectedCategory] = useState(Object.keys(TEMPLATES)[0]);

  function useTemplate(template) {
    // Navigate to chat and pre-fill the prompt
    if (bridge?.store) bridge.store.set('pendingPrompt', template.prompt);
    setPage('chat');
  }

  return (
    <div className="page">
      <div className="page-title">📋 Templates</div>
      <div className="page-sub">Pre-built prompts for common tasks. Pick one and start immediately — no prompt engineering needed.</div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        {Object.keys(TEMPLATES).map(cat => (
          <button key={cat} onClick={() => setSelectedCategory(cat)}
            style={{ padding: '6px 14px', borderRadius: 20, border: selectedCategory === cat ? '2px solid var(--gold)' : '1.5px solid rgba(0,0,0,.12)', background: selectedCategory === cat ? 'rgba(0,0,0,.08)' : 'var(--cloud)', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: selectedCategory === cat ? 'var(--earth)' : 'var(--text-dark)' }}
          >{cat}</button>
        ))}
      </div>

      <div style={{ display: 'grid', gap: 12 }}>
        {TEMPLATES[selectedCategory]?.map((t, i) => (
          <div key={i} onClick={() => useTemplate(t)}
            style={{ padding: '16px 18px', border: '1.5px solid rgba(0,0,0,.1)', borderRadius: 12, background: 'var(--cloud, #fff)', cursor: 'pointer', transition: 'all .15s' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--gold)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(0,0,0,.1)'; e.currentTarget.style.transform = 'none'; }}
          >
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--earth)', marginBottom: 4 }}>{t.title}</div>
            <div style={{ fontSize: 13, color: 'var(--text-light)', lineHeight: 1.5 }}>{t.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
