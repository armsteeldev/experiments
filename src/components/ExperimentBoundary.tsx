import { Component, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

type Props = { children: ReactNode }
type State = { hasError: boolean }

export default class ExperimentBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return <div className="experience-error" role="alert">
        <span className="experience-error-mark" aria-hidden="true">∴</span>
        <h1>This world did not open.</h1>
        <p>The study encountered an error. Return to the collection and choose another path.</p>
        <button type="button" onClick={() => window.location.reload()}>Reload this study</button>
        <Link to="/">Return to the collection <span aria-hidden="true">→</span></Link>
      </div>
    }

    return this.props.children
  }
}
