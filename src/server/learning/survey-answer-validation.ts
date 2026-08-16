import {
  isCalendarDate,
  type SurveyAnswerValue,
  type SurveyQuestion,
} from "#/features/survey/survey.schema";

export function validateAnswer(
  question: SurveyQuestion,
  value: SurveyAnswerValue | undefined,
):
  | { valid: true; answer?: SurveyAnswerValue }
  | { valid: false; message: string } {
  if (question.kind === "short_text" || question.kind === "long_text") {
    if (typeof value === "undefined" || value === "") {
      if (question.required)
        return { valid: false, message: `Answer “${question.prompt}”.` };
      return { valid: true };
    }
    if (typeof value !== "string" || value.length > question.maximumLength)
      return { valid: false, message: `Review “${question.prompt}”.` };
    const normalized = value.trim();
    if (question.required && !normalized)
      return { valid: false, message: `Answer “${question.prompt}”.` };
    if (question.kind === "short_text" && normalized) {
      if (
        question.format === "email" &&
        !EMAIL_ADDRESS_PATTERN.test(normalized)
      )
        return {
          valid: false,
          message: `Enter a valid email address for “${question.prompt}”.`,
        };
      if (question.format === "url" && !URL.canParse(normalized))
        return {
          valid: false,
          message: `Enter a valid URL for “${question.prompt}”.`,
        };
      if (
        question.format === "phone" &&
        !/^[+()\d][+()\d .-]{5,30}$/u.test(normalized)
      )
        return {
          valid: false,
          message: `Enter a valid phone number for “${question.prompt}”.`,
        };
    }
    return normalized ? { valid: true, answer: normalized } : { valid: true };
  }

  if (question.kind === "checkbox") {
    if (value === true) return { valid: true, answer: true };
    if (question.required)
      return { valid: false, message: `Confirm “${question.prompt}”.` };
    return value === false ? { valid: true, answer: false } : { valid: true };
  }

  if (question.kind === "number" || question.kind === "rating") {
    if (typeof value === "undefined" || value === "") {
      if (question.required)
        return { valid: false, message: `Answer “${question.prompt}”.` };
      return { valid: true };
    }
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      (question.kind === "number" &&
        question.integer &&
        !Number.isInteger(value)) ||
      (question.minimum !== null && value < question.minimum) ||
      (question.maximum !== null && value > question.maximum)
    )
      return { valid: false, message: `Review “${question.prompt}”.` };
    return { valid: true, answer: value };
  }

  if (question.kind === "date") {
    if (typeof value === "undefined" || value === "") {
      if (question.required)
        return { valid: false, message: `Answer “${question.prompt}”.` };
      return { valid: true };
    }
    if (
      typeof value !== "string" ||
      !isCalendarDate(value) ||
      (question.minimum !== null && value < question.minimum) ||
      (question.maximum !== null && value > question.maximum)
    )
      return { valid: false, message: `Review “${question.prompt}”.` };
    return { valid: true, answer: value };
  }

  const optionIds = new Set(question.options.map((option) => option.id));
  if (question.kind === "single_choice" || question.kind === "dropdown") {
    if (typeof value === "undefined" || value === "") {
      if (question.required)
        return {
          valid: false,
          message: `Choose an answer for “${question.prompt}”.`,
        };
      return { valid: true };
    }
    if (typeof value !== "string" || !optionIds.has(value))
      return {
        valid: false,
        message: `Choose an answer for “${question.prompt}”.`,
      };
    return { valid: true, answer: value };
  }

  if (typeof value === "undefined") {
    if (question.required)
      return {
        valid: false,
        message: `Choose an answer for “${question.prompt}”.`,
      };
    return { valid: true };
  }
  if (!Array.isArray(value))
    return { valid: false, message: `Review “${question.prompt}”.` };
  const unique = [...new Set(value)];
  if (
    unique.some((optionId) => !optionIds.has(optionId)) ||
    (question.required && unique.length === 0)
  )
    return {
      valid: false,
      message: `Choose an answer for “${question.prompt}”.`,
    };
  return unique.length > 0 ? { valid: true, answer: unique } : { valid: true };
}

const EMAIL_ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
