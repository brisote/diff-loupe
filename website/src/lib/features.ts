const flag = import.meta.env.PUBLIC_AI_REVIEW ?? process.env.PUBLIC_AI_REVIEW;

export const aiReviewEnabled = flag === "1" || flag === "true";
