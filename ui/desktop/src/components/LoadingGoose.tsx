import { brandMessage } from '../branding';
import BrandIcon from '../branding/BrandIcon';
import BrandAnimation from '../branding/BrandAnimation';
import { ChatState } from '../types/chatState';
import { defineMessages, useIntl } from '../i18n';

interface LoadingGooseProps {
  message?: string;
  chatState?: ChatState;
}

const i18n = defineMessages({
  loadingConversation: {
    id: 'loadingGoose.loadingConversation',
    defaultMessage: 'loading conversation...',
  },
  restartingAgent: {
    id: 'loadingGoose.restartingAgent',
    defaultMessage: 'restarting session...',
  },
});

const STATE_ICONS: Record<ChatState, React.ReactNode> = {
  [ChatState.LoadingConversation]: <BrandAnimation className="flex-shrink-0" />,
  [ChatState.Thinking]: <BrandAnimation className="flex-shrink-0" />,
  [ChatState.Streaming]: <BrandAnimation className="flex-shrink-0" />,
  [ChatState.WaitingForUserInput]: <BrandIcon width={28} height={28} className="flex-shrink-0" />,
  [ChatState.Compacting]: <BrandAnimation className="flex-shrink-0" />,
  [ChatState.Idle]: <BrandIcon width={28} height={28} className="flex-shrink-0" />,
  [ChatState.RestartingAgent]: <BrandAnimation className="flex-shrink-0" />,
};

const STATE_MESSAGES = {
  [ChatState.LoadingConversation]: i18n.loadingConversation,
  [ChatState.Thinking]: brandMessage('loadingGoose.thinking'),
  [ChatState.Streaming]: brandMessage('loadingGoose.streaming'),
  [ChatState.WaitingForUserInput]: brandMessage('loadingGoose.waiting'),
  [ChatState.Compacting]: brandMessage('loadingGoose.compacting'),
  [ChatState.Idle]: brandMessage('loadingGoose.idle'),
  [ChatState.RestartingAgent]: i18n.restartingAgent,
};

const LoadingGoose = ({ message, chatState = ChatState.Idle }: LoadingGooseProps) => {
  const intl = useIntl();
  const displayMessage = message || intl.formatMessage(STATE_MESSAGES[chatState]);
  const icon = STATE_ICONS[chatState];

  return (
    <div className="w-full animate-fade-slide-up">
      <div
        data-testid="loading-indicator"
        className="flex items-center gap-2 text-xs text-text-primary py-2"
      >
        {icon}
        {displayMessage}
      </div>
    </div>
  );
};

export default LoadingGoose;
