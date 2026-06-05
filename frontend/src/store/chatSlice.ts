import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { ChatMessage, Artifact, AskUserPayload } from '../types/trace'

interface ChatState {
  messages: ChatMessage[]
  pendingQuestion: AskUserPayload | null
  liveStatus: string
}

const initialState: ChatState = {
  messages: [],
  pendingQuestion: null,
  liveStatus: '',
}

const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    addUserMessage(state, action: PayloadAction<string>) {
      state.messages.push({
        id: `msg-${Date.now()}`,
        role: 'user',
        text: action.payload,
        artifacts: [],
        timestamp: Date.now(),
      })
    },

    addAssistantMessage(state, action: PayloadAction<{ text: string; artifacts: Artifact[] }>) {
      state.messages.push({
        id: `msg-${Date.now()}`,
        role: 'assistant',
        text: action.payload.text,
        artifacts: action.payload.artifacts,
        timestamp: Date.now(),
      })
    },

    setPendingQuestion(state, action: PayloadAction<AskUserPayload | null>) {
      state.pendingQuestion = action.payload
    },

    setLiveStatus(state, action: PayloadAction<string>) {
      state.liveStatus = action.payload
    },

    reset: () => initialState,
  },
})

export const {
  addUserMessage,
  addAssistantMessage,
  setPendingQuestion,
  setLiveStatus,
  reset: resetChat,
} = chatSlice.actions
export const chatReducer = chatSlice.reducer
