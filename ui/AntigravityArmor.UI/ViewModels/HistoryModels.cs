namespace AntigravityArmor.UI.ViewModels;

public class ApiKeyItem
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Key { get; set; } = string.Empty;
    public string KeyMasked { get; set; } = string.Empty;
    public string CreatedAt { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
}

public class ConversationSummary
{
    public string Id { get; set; } = string.Empty;
    public string CreatedAt { get; set; } = string.Empty;
    public string UpdatedAt { get; set; } = string.Empty;
    public int Turns { get; set; }
    public int MessageCount { get; set; }
    public string Snippet { get; set; } = string.Empty;
}

public class ConversationDetail
{
    public ConversationMessage[] Messages { get; set; } = System.Array.Empty<ConversationMessage>();
}

public class ConversationMessage
{
    public string Role { get; set; } = string.Empty;
    public string Text { get; set; } = string.Empty;
}

public class ModelMappingItem
{
    public string ClaudeModel { get; set; } = string.Empty;
    public string Family { get; set; } = string.Empty;
    public string Level { get; set; } = string.Empty;
    public string GoogleModel { get; set; } = string.Empty;
}
