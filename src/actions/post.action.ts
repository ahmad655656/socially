"use server"; // توجيه يشير إلى أن هذا الكود يعمل على جانب الخادم (Server-Side)

import { prisma } from "@/lib/prisma"; // استيراد كائن Prisma للتفاعل مع قاعدة البيانات
import { getDbUserId } from "./user.action"; // استيراد دالة للحصول على ID المستخدم من قاعدة البيانات
import { revalidatePath } from "next/cache"; // استيراد دالة لإعادة تحميل المسارات

/**
 * وظيفة لإنشاء منشور جديد
 * @param content - نص المنشور
 * @param image - رابط صورة المنشور
 * @returns كائن يحتوي على حالة العملية وبيانات المنشور أو الخطأ
 */
export async function createPost(content: string, image: string) {
  try {
    // الخطوة 1: الحصول على ID المستخدم الحالي
    const userId = await getDbUserId();

    if(!userId) return;
    // الخطوة 2: إنشاء المنشور في قاعدة البيانات باستخدام Prisma
    const post = await prisma.post.create({
      data: {
        content, // نص المنشور
        image, // صورة المنشور
        authorId: userId, // ID المستخدم المنشئ للمحتوى
      },
    });

    // الخطوة 3: إعادة تحميل الصفحة الرئيسية لعرض التحديثات
    revalidatePath("/");

    // الخطوة 4: إرجاع النتيجة الناجحة مع بيانات المنشور
    return {
      success: true, // حالة النجاح
      post: {
        id: post.id, // ID المنشور
        content: post.content, // نص المنشور
        image: post.image, // صورة المنشور
        createdAt: post.createdAt, // تاريخ الإنشاء
        authorId: post.authorId, // ID المؤلف
      },
    };
    
  } catch (error) {
    // معالجة الأخطاء
    console.error("فشل إنشاء المنشور:", error);
    
    // إرجاع رسالة الخطأ
    return {
      success: false, // حالة الفشل
      error: error instanceof Error ? error.message : "فشل إنشاء المنشور",
    };
  }
}

export async function getPosts() {
  try {
    const posts = await prisma.post.findMany(
      {
        orderBy: {
          createdAt: "desc"
        },
        include: {
          author: {
            select: {
              id: true,
              name: true,
              image: true,
              username: true
            }
          },
          comments: {
            include: {
              author: {
                select: {
                  id: true,
                  username: true,
                  image: true,
                  name: true
                }
              }
            },
            orderBy: {
              createdAt: "asc"
            }

          },
          likes: {
            select: {
              userId: true
            }
          },
          _count: {
            select: {
              likes: true
            }
          }
        }
      }
    );
    return posts
  } catch (error) {
    console.log("Error in getPosts", error)
    throw new Error("Failed in fetch posts")
  }
}
export async function toggleLike(postId: string) {
  try {
    const userId = await getDbUserId();
    if (!userId) return;

    // check if like exists
    const existingLike = await prisma.like.findUnique({
      where: {
        userId_postId: {
          userId,
          postId,
        },
      },
    });

    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { authorId: true },
    });

    if (!post) throw new Error("Post not found");

    if (existingLike) {
      // unlike
      await prisma.like.delete({
        where: {
          userId_postId: {
            userId,
            postId,
          },
        },
      });
    } else {
      // like and create notification (only if liking someone else's post)
      await prisma.$transaction([
        prisma.like.create({
          data: {
            userId,
            postId,
          },
        }),
        ...(post.authorId !== userId
          ? [
              prisma.notification.create({
                data: {
                  type: "LIKE",
                  userId: post.authorId, // recipient (post author)
                  creatorId: userId, // person who liked
                  postId,
                },
              }),
            ]
          : []),
      ]);
    }

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Failed to toggle like:", error);
    return { success: false, error: "Failed to toggle like" };
  }
}

export async function createComment(postId: string, content: string) {
  try {
    const userId = await getDbUserId();

    if (!userId) return;
    if (!content) throw new Error("Content is required");

    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { authorId: true },
    });

    if (!post) throw new Error("Post not found");

    // Create comment and notification in a transaction
    const [comment] = await prisma.$transaction(async (tx) => {
      // Create comment first
      const newComment = await tx.comment.create({
        data: {
          content,
          authorId: userId,
          postId,
        },
      });

      // Create notification if commenting on someone else's post
      if (post.authorId !== userId) {
        await tx.notification.create({
          data: {
            type: "COMMENT",
            userId: post.authorId,
            creatorId: userId,
            postId,
            commentId: newComment.id,
          },
        });
      }

      return [newComment];
    });

    revalidatePath(`/`);
    return { success: true, comment };
  } catch (error) {
    console.error("Failed to create comment:", error);
    return { success: false, error: "Failed to create comment" };
  }
}

export async function deletePost(postId: string) {
  try {
    const userId = await getDbUserId();

    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { authorId: true },
    });

    if (!post) throw new Error("Post not found");
    if (post.authorId !== userId) throw new Error("Unauthorized - no delete permission");

    await prisma.post.delete({
      where: { id: postId },
    });

    revalidatePath("/"); // purge the cache
    return { success: true };
  } catch (error) {
    console.error("Failed to delete post:", error);
    return { success: false, error: "Failed to delete post" };
  }
}
