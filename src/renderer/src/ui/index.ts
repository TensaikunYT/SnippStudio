// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The building blocks (SnippStudio phase 3a). The whole interface is made of
// these, its words come from t() (ui/strings.ts) and its icons from Icon. The
// old controls (components/controls.tsx, Section, MenuButton) went in phase
// 3c.4b; no file outside ui/ writes a <button> of its own (BareButton).
export { Icon, type IconName, type IconProps } from './Icon'
export { Button, IconButton, BareButton, type ButtonProps, type BareButtonProps, type ButtonVariant, type ControlSize, type IconButtonProps } from './Button'
export { TextField, TextArea, NumberField, Select, Field, InfoMark, type TextFieldProps, type TextAreaProps, type NumberFieldProps, type SelectProps, type SelectOption, type FieldProps } from './fields'
export { Slider, type SliderProps, type SliderGesture } from './Slider'
export { ScrubField, type ScrubFieldProps } from './ScrubField'
export { Toggle, Checkbox, Segmented, Tabs, type ToggleProps, type CheckboxProps, type SegmentedProps, type SegmentOption, type TabsProps, type TabItem } from './choice'
export { Menu, MenuTrigger, type MenuItem, type MenuProps, type MenuTriggerProps } from './Menu'
export { Dialog, useModalFocus, type DialogProps } from './Dialog'
export { confirmDialog, type ConfirmOptions } from './confirm'
export { Tooltip, TooltipBubble, TOOLTIP_DELAY, type TooltipProps } from './Tooltip'
export { ToastStack, ToastView, notify, dismissToast, clearToasts, type NotifyOptions } from './Toasts'
export { Chip, type ChipProps, type ChipTone } from './Chip'
export { t, useT, setLang, getLang, type StringKey, type Lang } from './strings'
export { localizeMessage, errorText } from './errors'
export { Section, SubSection, SectionScope, InspectorCard, useCardPart, type SectionProps, type SubSectionProps } from './Section'
