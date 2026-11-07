import { Empty } from './common'

// Guides see only Calendar + Heritage. Both arrive with their module migrations;
// until then this screen confirms the login works and shows nothing else.
export default function GuideHome({ section }) {
  return (
    <div className="view">
      <Empty>
        {section === 'calendar'
          ? 'Your guide calendar will appear here once the guide schedule is switched on.'
          : 'Heritage trip folders will appear here once the heritage module is switched on.'}
      </Empty>
    </div>
  )
}
