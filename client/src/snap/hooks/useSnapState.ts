import { useMemo, useReducer } from "react";

export type SnapStatus =
  | "idle"
  | "camera"
  | "recording"
  | "preview"
  | "uploading"
  | "sent"
  | "viewer";

export type SnapDraft = {
  kind: "photo" | "video";
  blob: Blob;
  previewUrl: string;
  fileName: string;
  mimeType: string;
  durationMs: number;
  thumbnailUrl?: string | null;
  filterAppliedInMedia?: boolean;
};

type SnapState = {
  status: SnapStatus;
  draft: SnapDraft | null;
  activeFilterId: string;
  caption: string;
  error: string;
};

type SnapAction =
  | { type: "OPEN_CAMERA" }
  | { type: "START_RECORDING" }
  | { type: "SHOW_PREVIEW"; draft: SnapDraft }
  | { type: "SET_FILTER"; filterId: string }
  | { type: "SET_CAPTION"; caption: string }
  | { type: "START_UPLOAD" }
  | { type: "UPLOAD_SUCCESS" }
  | { type: "UPLOAD_FAILED"; error: string }
  | { type: "OPEN_VIEWER" }
  | { type: "CLOSE_VIEWER" }
  | { type: "SET_ERROR"; error: string }
  | { type: "RESET" };

const initialState: SnapState = {
  status: "idle",
  draft: null,
  activeFilterId: "bloom",
  caption: "",
  error: ""
};

function snapStateReducer(state: SnapState, action: SnapAction): SnapState {
  switch (action.type) {
    case "OPEN_CAMERA":
      return {
        ...state,
        status: "camera",
        draft: null,
        caption: "",
        error: ""
      };
    case "START_RECORDING":
      return {
        ...state,
        status: "recording",
        error: ""
      };
    case "SHOW_PREVIEW":
      return {
        ...state,
        status: "preview",
        draft: action.draft,
        error: ""
      };
    case "SET_FILTER":
      return {
        ...state,
        activeFilterId: action.filterId
      };
    case "SET_CAPTION":
      return {
        ...state,
        caption: action.caption
      };
    case "START_UPLOAD":
      return {
        ...state,
        status: "uploading",
        error: ""
      };
    case "UPLOAD_SUCCESS":
      return {
        ...state,
        status: "sent",
        error: ""
      };
    case "UPLOAD_FAILED":
      return {
        ...state,
        status: "preview",
        error: action.error
      };
    case "OPEN_VIEWER":
      return {
        ...state,
        status: "viewer"
      };
    case "CLOSE_VIEWER":
      return {
        ...state,
        status: "idle"
      };
    case "SET_ERROR":
      return {
        ...state,
        error: action.error
      };
    case "RESET":
      return initialState;
    default:
      return state;
  }
}

export function useSnapState() {
  const [state, dispatch] = useReducer(snapStateReducer, initialState);

  return useMemo(
    () => ({
      state,
      openCamera: () => dispatch({ type: "OPEN_CAMERA" }),
      startRecording: () => dispatch({ type: "START_RECORDING" }),
      showPreview: (draft: SnapDraft) => dispatch({ type: "SHOW_PREVIEW", draft }),
      setFilter: (filterId: string) => dispatch({ type: "SET_FILTER", filterId }),
      setCaption: (caption: string) => dispatch({ type: "SET_CAPTION", caption }),
      startUpload: () => dispatch({ type: "START_UPLOAD" }),
      markSent: () => dispatch({ type: "UPLOAD_SUCCESS" }),
      failUpload: (error: string) => dispatch({ type: "UPLOAD_FAILED", error }),
      openViewer: () => dispatch({ type: "OPEN_VIEWER" }),
      closeViewer: () => dispatch({ type: "CLOSE_VIEWER" }),
      setError: (error: string) => dispatch({ type: "SET_ERROR", error }),
      reset: () => dispatch({ type: "RESET" })
    }),
    [state]
  );
}
