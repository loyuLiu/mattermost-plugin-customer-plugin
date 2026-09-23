package main

import (
	"errors"
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
)

func post(id, userID, message string, createAt int64) *model.Post {
	return &model.Post{
		Id:        id,
		UserId:    userID,
		Message:   message,
		CreateAt:  createAt,
		ChannelId: "channel1",
	}
}

func TestMatchesFilter(t *testing.T) {
	target := post("p1", "alice", "hello WORLD", 1000)

	t.Run("empty filter matches everything", func(t *testing.T) {
		if !matchesFilter(target, bulkFilter{}) {
			t.Fatal("expected an empty filter to match")
		}
	})

	t.Run("author", func(t *testing.T) {
		if !matchesFilter(target, bulkFilter{UserID: "alice"}) {
			t.Fatal("expected the author to match")
		}
		if matchesFilter(target, bulkFilter{UserID: "bob"}) {
			t.Fatal("expected another author not to match")
		}
	})

	t.Run("keyword is case insensitive", func(t *testing.T) {
		if !matchesFilter(target, bulkFilter{Keyword: "hello"}) {
			t.Fatal("expected 'hello' to match")
		}
		if !matchesFilter(target, bulkFilter{Keyword: "WORLD"}) {
			t.Fatal("expected 'WORLD' to match")
		}
		if matchesFilter(target, bulkFilter{Keyword: "nope"}) {
			t.Fatal("expected 'nope' not to match")
		}
	})

	t.Run("time window", func(t *testing.T) {
		if !matchesFilter(target, bulkFilter{TimeFrom: 1000, TimeTo: 1000}) {
			t.Fatal("expected the bounds to be inclusive")
		}
		if matchesFilter(target, bulkFilter{TimeFrom: 1001}) {
			t.Fatal("expected a post older than TimeFrom not to match")
		}
		if matchesFilter(target, bulkFilter{TimeTo: 999}) {
			t.Fatal("expected a post newer than TimeTo not to match")
		}
	})

	t.Run("nil post never matches", func(t *testing.T) {
		if matchesFilter(nil, bulkFilter{}) {
			t.Fatal("expected nil not to match")
		}
	})
}

func TestIsDescending(t *testing.T) {
	desc := []*model.Post{post("a", "u", "", 30), post("b", "u", "", 20), post("c", "u", "", 10)}
	if !isDescending(desc) {
		t.Fatal("expected a newest-first list to be detected as descending")
	}

	asc := []*model.Post{post("a", "u", "", 10), post("b", "u", "", 20)}
	if isDescending(asc) {
		t.Fatal("expected an oldest-first list not to be detected as descending")
	}
}

func TestScanPosts(t *testing.T) {
	// One channel of five posts, newest first.
	newest := post("p5", "alice", "five", 500)
	posts := []*model.Post{
		newest,
		post("p4", "bob", "four", 400),
		post("p3", "alice", "three", 300),
		post("p2", "bob", "two", 200),
		post("p1", "alice", "one", 100),
	}

	fetcher := func(pages [][]*model.Post) pageFetcher {
		return func(page int) ([]*model.Post, error) {
			if page >= len(pages) {
				return nil, nil
			}
			return pages[page], nil
		}
	}

	t.Run("collects every match across pages", func(t *testing.T) {
		fetch := fetcher([][]*model.Post{posts})
		matched, truncated, err := scanPosts(fetch, bulkFilter{}, 100)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(matched) != 5 {
			t.Fatalf("expected 5 matches, got %d", len(matched))
		}
		if truncated {
			t.Fatal("expected the scan not to be truncated")
		}
	})

	t.Run("filters by author and keyword", func(t *testing.T) {
		fetch := fetcher([][]*model.Post{posts})
		matched, _, err := scanPosts(fetch, bulkFilter{UserID: "alice"}, 100)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(matched) != 3 {
			t.Fatalf("expected 3 messages from alice, got %d", len(matched))
		}
	})

	t.Run("stops early once past TimeFrom", func(t *testing.T) {
		// A full page (otherwise the scan ends because the page is short) whose posts run
		// from 1000 down to 801. TimeFrom 950 stops it halfway through, so no second page
		// is ever requested.
		pages := 0
		fetch := func(page int) ([]*model.Post, error) {
			pages++
			pagePosts := make([]*model.Post, 0, postsPerPage)
			for i := 0; i < postsPerPage; i++ {
				pagePosts = append(pagePosts, post("p", "u", "m", int64(1000-i)))
			}
			return pagePosts, nil
		}

		matched, _, err := scanPosts(fetch, bulkFilter{TimeFrom: 950}, 1000)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if pages != 1 {
			t.Fatalf("expected the scan to stop after 1 page, fetched %d", pages)
		}
		if len(matched) != 51 {
			t.Fatalf("expected the 51 posts at or after 950, got %d", len(matched))
		}
	})

	t.Run("keeps scanning when the order is not descending", func(t *testing.T) {
		// Oldest first: the early exit must not fire, or the tail of the channel is lost.
		ascending := make([]*model.Post, 0, postsPerPage)
		for i := 0; i < postsPerPage; i++ {
			ascending = append(ascending, post("p", "u", "m", int64(100+i)))
		}

		pages := 0
		fetch := func(page int) ([]*model.Post, error) {
			pages++
			if page == 0 {
				return ascending, nil
			}
			return []*model.Post{newest}, nil
		}

		matched, _, err := scanPosts(fetch, bulkFilter{TimeFrom: 50}, 1000)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if pages != 2 {
			t.Fatalf("expected both pages to be scanned, fetched %d", pages)
		}
		if len(matched) != postsPerPage+1 {
			t.Fatalf("expected %d matches, got %d", postsPerPage+1, len(matched))
		}
	})

	t.Run("stops at the limit", func(t *testing.T) {
		fetch := fetcher([][]*model.Post{posts})
		matched, truncated, err := scanPosts(fetch, bulkFilter{}, 2)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(matched) != 2 {
			t.Fatalf("expected 2 matches, got %d", len(matched))
		}
		if !truncated {
			t.Fatal("expected the result to be reported as truncated")
		}
	})

	t.Run("propagates fetch errors", func(t *testing.T) {
		fetch := func(page int) ([]*model.Post, error) {
			return nil, errors.New("boom")
		}

		if _, _, err := scanPosts(fetch, bulkFilter{}, 10); err == nil {
			t.Fatal("expected the error to be propagated")
		}
	})
}

func TestAllowedToDelete(t *testing.T) {
	own := post("p1", "me", "mine", 1)
	others := post("p2", "someone", "theirs", 2)

	t.Run("system administrator deletes anything", func(t *testing.T) {
		if !allowedToDelete(others, "me", true, false, false, false) {
			t.Fatal("expected a system admin to be allowed")
		}
	})

	t.Run("own post needs delete_post", func(t *testing.T) {
		if !allowedToDelete(own, "me", false, true, true, false) {
			t.Fatal("expected the author to be allowed with delete_post")
		}
		if allowedToDelete(own, "me", false, true, false, false) {
			t.Fatal("expected the author to be denied without delete_post")
		}
	})

	t.Run("someone else's post needs delete_others_posts", func(t *testing.T) {
		if !allowedToDelete(others, "me", false, false, true, true) {
			t.Fatal("expected a channel admin to be allowed with delete_others_posts")
		}
		if allowedToDelete(others, "me", false, false, true, false) {
			t.Fatal("expected delete_post alone not to cover someone else's post")
		}
	})

	t.Run("nil post and anonymous actor are denied", func(t *testing.T) {
		if allowedToDelete(nil, "me", true, false, false, false) {
			t.Fatal("expected a nil post to be denied")
		}
		if allowedToDelete(others, "", false, false, false, true) {
			t.Fatal("expected an anonymous actor to be denied")
		}
	})
}

func TestMaxPostsFor(t *testing.T) {
	p := newTestPlugin(&configuration{BulkDeleteEnabled: true})
	p.setConfiguration(&configuration{BulkDeleteEnabled: true, BulkDeleteMaxPosts: 100})

	if got := p.maxPostsFor(0); got != 100 {
		t.Fatalf("expected the configured ceiling, got %d", got)
	}
	if got := p.maxPostsFor(50); got != 50 {
		t.Fatalf("expected a smaller request to be honoured, got %d", got)
	}
	if got := p.maxPostsFor(5000); got != 100 {
		t.Fatalf("expected an oversized request to be clamped, got %d", got)
	}

	// A misconfigured ceiling must not turn into "unlimited".
	p.setConfiguration(&configuration{BulkDeleteEnabled: true, BulkDeleteMaxPosts: 0})
	if got := p.maxPostsFor(0); got != hardMaxPosts {
		t.Fatalf("expected the hard ceiling, got %d", got)
	}
}

func TestSampleOf(t *testing.T) {
	posts := []*model.Post{
		post("old", "u", "oldest", 100),
		post("new", "u", "newest", 300),
		post("mid", "u", "middle", 200),
	}

	sample := sampleOf(posts)
	if len(sample) != 3 {
		t.Fatalf("expected 3 samples, got %d", len(sample))
	}
	if sample[0].ID != "new" || sample[2].ID != "old" {
		t.Fatalf("expected samples newest first, got %v", sample)
	}

	long := "0123456789"
	for i := 0; i < 30; i++ {
		long += "0123456789"
	}
	if got := sampleOf([]*model.Post{post("p", "u", long, 1)})[0].Message; len(got) != 200 {
		t.Fatalf("expected long messages to be trimmed, got %d chars", len(got))
	}
}

func TestSanitizeBulkDelete(t *testing.T) {
	c := &configuration{}
	c.sanitizeBulkDelete()
	if c.BulkDeleteMaxPosts != DefaultBulkDeleteMaxPosts {
		t.Fatalf("expected the default ceiling, got %d", c.BulkDeleteMaxPosts)
	}

	c = &configuration{BulkDeleteMaxPosts: -5}
	c.sanitizeBulkDelete()
	if c.BulkDeleteMaxPosts != DefaultBulkDeleteMaxPosts {
		t.Fatalf("expected a negative ceiling to fall back, got %d", c.BulkDeleteMaxPosts)
	}

	c = &configuration{BulkDeleteMaxPosts: hardMaxPosts + 1}
	c.sanitizeBulkDelete()
	if c.BulkDeleteMaxPosts != hardMaxPosts {
		t.Fatalf("expected the ceiling to be clamped, got %d", c.BulkDeleteMaxPosts)
	}
}
