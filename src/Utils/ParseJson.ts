
export const parseJSON = (
    rawSelector: string | undefined
): Record<string, string> => {
    const trimmed = rawSelector?.trim();
    if (!trimmed) {
        return {};
    }

    return JSON.parse(trimmed) as Record<string, string>;
};
