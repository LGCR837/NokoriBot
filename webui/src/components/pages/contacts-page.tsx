import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, UserPlus, Search, User, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useApi } from '@/lib/api';
import { useActionFeedback } from '@/contexts/ActionFeedbackContext';
import type { NokoriBotFriend, NokoriBotGroup } from '@/types';

export function ContactsPage() {
  const api = useApi();
  const { startAction } = useActionFeedback();
  const [friends, setFriends] = useState<NokoriBotFriend[]>([]);
  const [groups, setGroups] = useState<NokoriBotGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [friendSearch, setFriendSearch] = useState('');
  const [groupSearch, setGroupSearch] = useState('');
  const [addFriendUid, setAddFriendUid] = useState('');
  const [addGroupId, setAddGroupId] = useState('');

  const loadContacts = useCallback(async () => {
    setLoading(true);
    try {
      const [f, g] = await Promise.all([api.friends.list(), api.groups.list()]);
      setFriends(f);
      setGroups(g);
    } catch (e) {
      console.error('Failed to load contacts', e);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { void loadContacts(); }, [loadContacts]);

  const handleAddFriend = async () => {
    if (!addFriendUid.trim()) return;
    const handle = startAction({ title: '发送好友申请', detail: addFriendUid });
    try {
      await api.friends.request(addFriendUid);
      handle.succeed({ title: '已发送', detail: `好友申请已发送至 ${addFriendUid}` });
      setAddFriendUid('');
    } catch (e: any) {
      handle.fail(e.message || '操作失败', { title: '操作失败' });
    }
  };

  const handleJoinGroup = async () => {
    if (!addGroupId.trim()) return;
    const handle = startAction({ title: '申请加入群组', detail: addGroupId });
    try {
      await api.groups.join(addGroupId);
      handle.succeed({ title: '已发送', detail: `入群申请已发送至 ${addGroupId}` });
      setAddGroupId('');
    } catch (e: any) {
      handle.fail(e.message || '操作失败', { title: '操作失败' });
    }
  };

  const filteredFriends = friends.filter(f =>
    !friendSearch || f.name?.toLowerCase().includes(friendSearch.toLowerCase()) || f.uid?.includes(friendSearch)
  );

  const filteredGroups = groups.filter(g =>
    !groupSearch || g.name?.toLowerCase().includes(groupSearch.toLowerCase()) || g.group_id?.includes(groupSearch)
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">联系人</h1>
          <p className="text-sm text-muted-foreground">好友与群组管理</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadContacts()}>
          <RefreshCw className="size-4" />
          刷新
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
          加载中…
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* 好友 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <User className="size-4" />
                好友 ({filteredFriends.length})
              </CardTitle>
              <div className="flex gap-2 mt-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="搜索好友…"
                    value={friendSearch}
                    onChange={e => setFriendSearch(e.target.value)}
                    className="h-8 pl-8 text-xs"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="max-h-[400px] overflow-y-auto">
              <div className="flex gap-2 mb-3">
                <Input
                  placeholder="UID"
                  value={addFriendUid}
                  onChange={e => setAddFriendUid(e.target.value)}
                  className="h-8 text-xs"
                />
                <Button size="sm" onClick={() => void handleAddFriend()} disabled={!addFriendUid.trim()}>
                  <UserPlus className="size-3.5" />
                  添加
                </Button>
              </div>
              {filteredFriends.length === 0 ? (
                <p className="py-8 text-center text-xs text-muted-foreground">暂无好友数据</p>
              ) : (
                <div className="space-y-1">
                  {filteredFriends.map(f => (
                    <div key={f.uid} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50">
                      <span className="size-6 rounded-full bg-primary/10 flex items-center justify-center text-xs text-primary">
                        {(f.name || f.uid)?.[0]?.toUpperCase() || '?'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{f.name || f.uid}</span>
                        {f.name && <span className="block truncate text-xs text-muted-foreground">{f.uid}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 群组 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="size-4" />
                群组 ({filteredGroups.length})
              </CardTitle>
              <div className="flex gap-2 mt-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="搜索群组…"
                    value={groupSearch}
                    onChange={e => setGroupSearch(e.target.value)}
                    className="h-8 pl-8 text-xs"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="max-h-[400px] overflow-y-auto">
              <div className="flex gap-2 mb-3">
                <Input
                  placeholder="群号"
                  value={addGroupId}
                  onChange={e => setAddGroupId(e.target.value)}
                  className="h-8 text-xs"
                />
                <Button size="sm" onClick={() => void handleJoinGroup()} disabled={!addGroupId.trim()}>
                  <UserPlus className="size-3.5" />
                  加入
                </Button>
              </div>
              {filteredGroups.length === 0 ? (
                <p className="py-8 text-center text-xs text-muted-foreground">暂无群组数据</p>
              ) : (
                <div className="space-y-1">
                  {filteredGroups.map(g => (
                    <div key={g.group_id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50">
                      <span className="size-6 rounded-full bg-primary/10 flex items-center justify-center text-xs text-primary">
                        {(g.name || g.group_id)?.[0]?.toUpperCase() || '?'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{g.name || g.group_id}</span>
                        <span className="block truncate text-xs text-muted-foreground">{g.group_id}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
